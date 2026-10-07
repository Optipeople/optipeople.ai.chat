// Answer-correctness eval harness (docs/answer-correctness-plan.md fix H).
//
// Runs golden questions against the REAL chat endpoint, against the REAL
// knowledge base, and asserts on the answer, on which tools the model
// called, and on what retrieval actually returned. There is no mocking
// here on purpose: every cause of the 2026-08-19 wrong-DIP-switch answer
// lived in the seams between extraction, chunking, retrieval and the
// prompt, and a harness that stubs any of those cannot see the bug it
// exists to catch.
//
// Usage:
//   npm run dev                     # in another terminal
//   EVAL_MACHINE_ID=<machine> npm run eval
//   EVAL_MACHINE_ID=<machine> npm run eval -- nx502-dip-backup
//
// Env:
//   EVAL_MACHINE_ID          default machine for cases that don't name one
//   EVAL_BASE_URL            default http://localhost:3000
//   EVAL_TIMEOUT_MS          per-request ceiling, default 180000
//   EVAL_FORCE_VOYAGE_FAIL   "1" selects the infra-failure cases. The SAME
//                            variable must be set on the dev server, where
//                            embedQuery honours it by throwing, so the run
//                            exercises the keyword-only fallback. Cases
//                            without `infraFailure` are skipped in that
//                            mode and infra cases are skipped outside it.
//
// Auth: the harness reads the fixture machine's qr_token straight from
// machine_kb with the service-role key and passes it as X-QR-Token, which
// is the same door the shop-floor sticker uses. No Optipeople login needed.
//
// Retrieval visibility: the chat route persists every search_kb call as a
// `messages` row with role 'tool' and the returned kb_chunks ids in
// `tool_chunks`. The harness picks up the conversation id from the SSE
// `conversation` event and reads those rows back with the service client,
// so assertions can look at the chunks the model actually saw, not only at
// the prose it produced from them.
//
// Two modes per case:
//   single    ask once, assert on the answer and the tool calls.
//   pushback  ask, then feed the model a WRONG correction and assert it
//             holds its ground with a quote. Covers both halves of the
//             observed failure: overconfidence without evidence, and
//             capitulation to a confident human who is wrong.
//
// Exit code is 1 when any case fails, so this can gate a deploy.

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSupabaseServerClient } from "../src/lib/supabase.ts";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 180_000);
const FORCE_VOYAGE_FAIL = process.env.EVAL_FORCE_VOYAGE_FAIL === "1";
const CASES_DIR = join(process.cwd(), "evals", "cases");
const OUT_DIR = join(process.cwd(), "evals", "out");

// ---------------------------------------------------------------------------
// Case shape
// ---------------------------------------------------------------------------

type Assertion =
  // The answer must match this regex (case-insensitive by default).
  | { type: "matches"; pattern: string; flags?: string; label?: string }
  // The answer must NOT match. This is where the dangerous wrong answers
  // live: "pin 2" for a backup, a restore combination that is not a
  // documented function at all.
  | { type: "notMatches"; pattern: string; flags?: string; label?: string }
  // At least one of these must match. For wording that legitimately
  // varies between Danish and English, or between phrasings.
  | { type: "anyOf"; patterns: string[]; flags?: string; label?: string }
  // The model must have called this tool at least once this turn.
  | { type: "toolCalled"; name: string; label?: string }
  | { type: "toolNotCalled"; name: string; label?: string }
  // The answer must contain a fenced block or a Markdown table, i.e. it
  // quoted the source rather than paraphrasing a value out of it, AND at
  // least one quoted row/line must appear verbatim in a chunk that
  // search_kb actually returned this turn. A beautifully formatted table
  // that exists nowhere in the manual is the failure mode this pins.
  | { type: "quotesSource"; label?: string }
  // A source chip must point at one of these pages.
  | { type: "citesPage"; pages: number[]; label?: string }
  // Retrieval must have returned a chunk covering one of these pages
  // (page_from <= N <= page_to). This is the retrieval-side twin of
  // citesPage: it fails even when the model happens to answer correctly
  // from the wrong chunk.
  | { type: "pageInRetrieval"; pages: number[]; label?: string }
  // The answer must say the manual does not cover the question and must
  // not hand out a value with a unit. See REFUSAL_RE / VALUE_WITH_UNIT_RE.
  | { type: "mustRefuse"; label?: string };

type EvalCase = {
  id: string;
  /** What this case is protecting. Printed on failure. */
  about?: string;
  question: string;
  machineId?: string;
  mode?: "single" | "pushback";
  /** The wrong correction to inject. Required for mode "pushback". */
  pushback?: string;
  /** Assertions on the first answer. */
  assert: Assertion[];
  /** Assertions on the answer after the pushback. */
  assertAfterPushback?: Assertion[];
  /** Shorthand for a `mustRefuse` assertion on the first answer. */
  mustRefuse?: boolean;
  /**
   * Shorthand for a `pageInRetrieval` assertion on the first answer. One
   * page or several acceptable pages.
   */
  expectedPageInRetrieval?: number | number[];
  /**
   * Marks a case that only makes sense with an infrastructure failure
   * injected. "voyage": the embedding call fails, retrieval must fall back
   * to keyword-only search. Selected by EVAL_FORCE_VOYAGE_FAIL=1.
   */
  infraFailure?: "voyage";
};

// ---------------------------------------------------------------------------
// Chat client
// ---------------------------------------------------------------------------

type ChatTurn = {
  answer: string;
  toolCalls: string[];
  sources: { id: string; title: string; pageFrom: number | null }[];
  conversationId: string | null;
  error: string | null;
};

type RetrievedChunk = {
  id: string;
  text: string;
  page_from: number | null;
  page_to: number | null;
};

type WireMessage = { role: "user" | "assistant"; content: string };

async function askChat(args: {
  machineId: string;
  qrToken: string;
  messages: WireMessage[];
}): Promise<ChatTurn> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QR-Token": args.qrToken,
      },
      body: JSON.stringify({
        machineId: args.machineId,
        messages: args.messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /api/chat ${res.status}: ${body.slice(0, 400)}`);
  }

  const turn: ChatTurn = {
    answer: "",
    toolCalls: [],
    sources: [],
    conversationId: null,
    error: null,
  };

  // Minimal SSE reader. The route emits `event: <name>` followed by one
  // `data: <json>` line and a blank line.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      }
      if (dataLines.length === 0) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      if (event === "delta") {
        turn.answer += (payload as { text?: string }).text ?? "";
      } else if (event === "tool_use") {
        const name = (payload as { name?: string }).name;
        if (name) turn.toolCalls.push(name);
      } else if (event === "sources") {
        const sources = (payload as { sources?: ChatTurn["sources"] }).sources;
        if (Array.isArray(sources)) turn.sources = sources;
      } else if (event === "conversation") {
        const id = (payload as { id?: string }).id;
        if (typeof id === "string") turn.conversationId = id;
      } else if (event === "error") {
        const p = payload as { message?: string; title?: string };
        turn.error = p.message ?? p.title ?? "unknown error";
      }
    }
  }
  return turn;
}

// The chunks search_kb returned during this conversation. Every tool
// execution is persisted as a role='tool' message carrying the chunk ids,
// so this is exactly what the model had in front of it, in the same text
// the model saw.
async function retrievedChunksFor(
  conversationId: string | null,
): Promise<RetrievedChunk[]> {
  if (!conversationId) return [];
  const supabase = getSupabaseServerClient();
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("tool_chunks")
    .eq("conversation_id", conversationId)
    .eq("role", "tool");
  if (error) throw new Error(`messages lookup failed: ${error.message}`);
  const ids = new Set<string>();
  for (const m of (msgs ?? []) as { tool_chunks: string[] | null }[]) {
    for (const id of m.tool_chunks ?? []) ids.add(id);
  }
  if (ids.size === 0) return [];
  const { data: chunks, error: chunkErr } = await supabase
    .from("kb_chunks")
    .select("id, text, page_from, page_to")
    .in("id", [...ids]);
  if (chunkErr) throw new Error(`kb_chunks lookup failed: ${chunkErr.message}`);
  return (chunks ?? []) as RetrievedChunk[];
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

type Failure = { assertion: string; detail: string };

function describe(a: Assertion): string {
  if (a.label) return a.label;
  switch (a.type) {
    case "matches":
      return `answer matches /${a.pattern}/`;
    case "notMatches":
      return `answer does NOT match /${a.pattern}/`;
    case "anyOf":
      return `answer matches one of ${a.patterns.map((p) => `/${p}/`).join(", ")}`;
    case "toolCalled":
      return `called ${a.name}`;
    case "toolNotCalled":
      return `did not call ${a.name}`;
    case "quotesSource":
      return "quoted the source verbatim (code block or table row present in a retrieved chunk)";
    case "citesPage":
      return `cited page ${a.pages.join(" or ")}`;
    case "pageInRetrieval":
      return `retrieval returned a chunk covering page ${a.pages.join(" or ")}`;
    case "mustRefuse":
      return "says the manual does not cover it and gives no value with a unit";
  }
}

// A fenced block, or a Markdown table row. Either counts as showing the
// operator the manual's own words instead of a paraphrase.
const QUOTE_RE = /```[\s\S]*?```|^[^\n]*\|[^\n]*\|[^\n]*$/m;

// Markdown table separator rows carry no content to look for.
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// Table padding, cell alignment and line wrapping differ between the
// manual's Markdown and the model's, so compare with pipes tightened and
// whitespace collapsed.
function normaliseQuote(s: string): string {
  return s
    .replace(/\s*\|\s*/g, "|")
    .replace(/^\|+|\|+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Every line the answer presents as a verbatim quote: table rows (minus
// separators) and the lines inside fenced blocks.
function quotedLines(answer: string): string[] {
  const out: string[] = [];
  for (const m of answer.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of m[1].split("\n")) {
      if (line.trim() && !TABLE_SEPARATOR_RE.test(line)) out.push(line);
    }
  }
  const withoutFences = answer.replace(/```[\s\S]*?```/g, "");
  for (const line of withoutFences.split("\n")) {
    if (/\|[^\n]*\|/.test(line) && !TABLE_SEPARATOR_RE.test(line)) out.push(line);
  }
  return out.map(normaliseQuote).filter((l) => l.length >= 3);
}

// "the manual does not cover this", in both languages the operators use.
const REFUSAL_RE = new RegExp(
  [
    // Danish
    "findes ikke",
    "d[æa]kker ikke",
    "ikke d[æa]kket",
    "ikke (?:i|en del af|tilg[æa]ngelig|beskrevet|omtalt|n[æa]vnt|dokumenteret)",
    "har ikke (?:oplysninger|information|dokumentation|noget)",
    "ingen (?:oplysninger|information|dokumentation)",
    "kan ikke finde",
    "uden ?for",
    // English
    "not (?:in|part of|available|covered|documented|mentioned|described)",
    "does ?n[o']t (?:cover|contain|include|mention|describe|have)",
    "no (?:information|documentation|coverage)",
    "(?:don'?t|do not|cannot|can'?t) (?:have|find)",
    "outside (?:the|of)",
  ].join("|"),
  "i",
);

// A number followed by a unit an operator could act on. Case-sensitive so
// "W629" (catalogue number) and "3 sider" do not fire; the lookarounds
// keep "NX502" and "E1-09" out.
const VALUE_WITH_UNIT_RE =
  /(?<![\w.,-])\d+(?:[.,]\d+)?\s?(?:Nm|N·m|N-m|kNm|kg|mm|cm|V|VDC|VAC|A|mA|W|kW|Hz|kHz|bar|kPa|MPa|°C|°F|rpm|ms|sec)(?![\w])/;

type CheckContext = { chunks: RetrievedChunk[] };

function check(a: Assertion, turn: ChatTurn, ctx: CheckContext): Failure | null {
  const fail = (detail: string): Failure => ({
    assertion: describe(a),
    detail,
  });
  switch (a.type) {
    case "matches":
      return new RegExp(a.pattern, a.flags ?? "i").test(turn.answer)
        ? null
        : fail("no match in the answer");
    case "notMatches":
      return new RegExp(a.pattern, a.flags ?? "i").test(turn.answer)
        ? fail("forbidden pattern present in the answer")
        : null;
    case "anyOf":
      return a.patterns.some((p) => new RegExp(p, a.flags ?? "i").test(turn.answer))
        ? null
        : fail("none of the alternatives matched");
    case "toolCalled":
      return turn.toolCalls.includes(a.name)
        ? null
        : fail(`tools called: ${turn.toolCalls.join(", ") || "(none)"}`);
    case "toolNotCalled":
      return turn.toolCalls.includes(a.name)
        ? fail(`tools called: ${turn.toolCalls.join(", ")}`)
        : null;
    case "quotesSource": {
      if (!QUOTE_RE.test(turn.answer)) {
        return fail("no fenced block and no table row in the answer");
      }
      const lines = quotedLines(turn.answer);
      if (lines.length === 0) {
        return fail("quote present but it carries no content lines");
      }
      if (ctx.chunks.length === 0) {
        return fail(
          "answer quotes something but no search_kb chunks were persisted " +
            "for this conversation (no conversation id, or search never ran)",
        );
      }
      const haystacks = ctx.chunks.map((c) => normaliseQuote(c.text));
      const found = lines.filter((l) => haystacks.some((h) => h.includes(l)));
      if (found.length > 0) return null;
      return fail(
        `none of the ${lines.length} quoted line(s) appears in any of the ` +
          `${ctx.chunks.length} retrieved chunk(s); first quoted line: ` +
          JSON.stringify(lines[0].slice(0, 120)),
      );
    }
    case "citesPage": {
      const cited = turn.sources
        .map((s) => s.pageFrom)
        .filter((p): p is number => typeof p === "number");
      return cited.some((p) => a.pages.includes(p))
        ? null
        : fail(`cited pages: ${cited.join(", ") || "(none)"}`);
    }
    case "pageInRetrieval": {
      const covered = ctx.chunks.some((c) => {
        if (typeof c.page_from !== "number") return false;
        const to = typeof c.page_to === "number" ? c.page_to : c.page_from;
        return a.pages.some((n) => c.page_from! <= n && n <= to);
      });
      if (covered) return null;
      const ranges = ctx.chunks
        .map((c) =>
          typeof c.page_from === "number"
            ? c.page_to && c.page_to !== c.page_from
              ? `${c.page_from}-${c.page_to}`
              : String(c.page_from)
            : "?",
        )
        .join(", ");
      return fail(`retrieved chunk pages: ${ranges || "(no chunks)"}`);
    }
    case "mustRefuse": {
      if (!REFUSAL_RE.test(turn.answer)) {
        return fail("no not-covered phrase (DA/EN) in the answer");
      }
      const m = VALUE_WITH_UNIT_RE.exec(turn.answer);
      if (m) return fail(`answer hands out a value with a unit: "${m[0]}"`);
      return null;
    }
  }
}

// Expands the case-level shorthands into assertions on the first answer.
function firstTurnAssertions(c: EvalCase): Assertion[] {
  const out: Assertion[] = [...c.assert];
  if (c.mustRefuse) {
    out.push({ type: "mustRefuse", label: "refuses: manual does not cover it" });
  }
  if (c.expectedPageInRetrieval !== undefined) {
    const pages = Array.isArray(c.expectedPageInRetrieval)
      ? c.expectedPageInRetrieval
      : [c.expectedPageInRetrieval];
    out.push({ type: "pageInRetrieval", pages });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type TurnRecord = {
  answer: string;
  toolCalls: string[];
  conversationId: string | null;
  retrievedChunks: { id: string; page_from: number | null; page_to: number | null }[];
};

type CaseResult = {
  id: string;
  about?: string;
  passed: boolean;
  skipped?: string;
  failures: Failure[];
  turns: TurnRecord[];
  error?: string;
};

async function loadCases(filter: string[]): Promise<EvalCase[]> {
  let names: string[];
  try {
    names = (await readdir(CASES_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    throw new Error(`no cases directory at ${CASES_DIR}`);
  }
  const cases: EvalCase[] = [];
  for (const name of names.sort()) {
    const raw = await readFile(join(CASES_DIR, name), "utf8");
    const parsed = JSON.parse(raw) as EvalCase;
    if (!parsed.id) throw new Error(`${name}: case has no id`);
    if (filter.length > 0 && !filter.includes(parsed.id)) continue;
    cases.push(parsed);
  }
  return cases;
}

async function qrTokenFor(machineId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("qr_token")
    .eq("machine_id", machineId)
    .maybeSingle();
  if (error) throw new Error(`qr_token lookup failed: ${error.message}`);
  const token = (data as { qr_token: string | null } | null)?.qr_token;
  if (!token) {
    throw new Error(
      `machine ${machineId} has no qr_token. Open its admin page and generate ` +
        "the QR code once, then re-run.",
    );
  }
  return token;
}

// Infra-failure cases need the fault injected on the server, which the
// harness cannot do over HTTP; the operator sets EVAL_FORCE_VOYAGE_FAIL=1
// on both processes. Running a normal case against a server with Voyage
// disabled, or an infra case against a healthy server, would measure the
// wrong thing, so each mode runs only its own cases.
function skipReason(c: EvalCase): string | null {
  if (c.infraFailure && !FORCE_VOYAGE_FAIL) {
    return "infra case: needs EVAL_FORCE_VOYAGE_FAIL=1 on server and harness";
  }
  if (!c.infraFailure && FORCE_VOYAGE_FAIL) {
    return "normal case: skipped while EVAL_FORCE_VOYAGE_FAIL=1";
  }
  return null;
}

async function recordTurn(turn: ChatTurn): Promise<{
  record: TurnRecord;
  ctx: CheckContext;
}> {
  const chunks = await retrievedChunksFor(turn.conversationId);
  return {
    record: {
      answer: turn.answer,
      toolCalls: turn.toolCalls,
      conversationId: turn.conversationId,
      retrievedChunks: chunks.map((c) => ({
        id: c.id,
        page_from: c.page_from,
        page_to: c.page_to,
      })),
    },
    ctx: { chunks },
  };
}

async function runCase(
  c: EvalCase,
  defaultMachineId: string | undefined,
): Promise<CaseResult> {
  const machineId = c.machineId ?? defaultMachineId;
  const result: CaseResult = {
    id: c.id,
    about: c.about,
    passed: false,
    failures: [],
    turns: [],
  };
  const skip = skipReason(c);
  if (skip) {
    result.skipped = skip;
    result.passed = true;
    return result;
  }
  if (!machineId) {
    result.error =
      "no machineId on the case and EVAL_MACHINE_ID is not set";
    return result;
  }

  try {
    const qrToken = await qrTokenFor(machineId);
    const messages: WireMessage[] = [{ role: "user", content: c.question }];
    const first = await askChat({ machineId, qrToken, messages });
    const firstRec = await recordTurn(first);
    result.turns.push(firstRec.record);
    if (first.error) {
      result.error = `chat error: ${first.error}`;
      return result;
    }
    for (const a of firstTurnAssertions(c)) {
      const f = check(a, first, firstRec.ctx);
      if (f) result.failures.push(f);
    }

    if (c.mode === "pushback") {
      if (!c.pushback) {
        result.error = 'mode "pushback" requires a pushback message';
        return result;
      }
      // The client owns the history, so replaying it with the wrong
      // correction appended is exactly what a real operator turn looks
      // like.
      const second = await askChat({
        machineId,
        qrToken,
        messages: [
          ...messages,
          { role: "assistant", content: first.answer },
          { role: "user", content: c.pushback },
        ],
      });
      const secondRec = await recordTurn(second);
      result.turns.push(secondRec.record);
      if (second.error) {
        result.error = `chat error (pushback): ${second.error}`;
        return result;
      }
      // The pushback turn is a new conversation on the wire, so its
      // retrieval is whatever the model fetched this time. A quote that
      // only exists in the FIRST turn's chunks is still the manual's text,
      // so both turns' chunks count.
      const ctx: CheckContext = {
        chunks: [...secondRec.ctx.chunks, ...firstRec.ctx.chunks],
      };
      for (const a of c.assertAfterPushback ?? []) {
        const f = check(a, second, ctx);
        if (f) result.failures.push(f);
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  result.passed = result.failures.length === 0;
  return result;
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const defaultMachineId = process.env.EVAL_MACHINE_ID;
  const cases = await loadCases(filter);
  if (cases.length === 0) {
    console.error("No cases matched.");
    process.exit(1);
  }

  console.log(
    `Running ${cases.length} case(s) against ${BASE_URL}` +
      (defaultMachineId ? ` (machine ${defaultMachineId})` : "") +
      (FORCE_VOYAGE_FAIL ? " [EVAL_FORCE_VOYAGE_FAIL=1: infra cases only]" : ""),
  );

  const results: CaseResult[] = [];
  // Sequential on purpose: these are real chat turns against one machine's
  // knowledge base, and a stampede of parallel Anthropic calls just trades
  // wall-clock for rate-limit retries.
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const r = await runCase(c, defaultMachineId);
    results.push(r);
    if (r.skipped) console.log(`skip (${r.skipped})`);
    else if (r.error) console.log(`ERROR (${r.error})`);
    else if (r.passed) console.log("pass");
    else console.log(`FAIL (${r.failures.length})`);
    for (const f of r.failures) {
      console.log(`      expected: ${f.assertion}`);
      console.log(`      actual:   ${f.detail}`);
    }
  }

  const skipped = results.filter((r) => r.skipped);
  const ran = results.filter((r) => !r.skipped);
  const failed = ran.filter((r) => !r.passed);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        machineId: defaultMachineId ?? null,
        forceVoyageFail: FORCE_VOYAGE_FAIL,
        total: ran.length,
        passed: ran.length - failed.length,
        skipped: skipped.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `\n${ran.length - failed.length}/${ran.length} passed` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : "") +
      `. Report: ${outPath}`,
  );
  if (ran.length === 0) {
    console.log("Nothing ran (every matched case was skipped).");
    process.exit(1);
  }
  if (failed.length > 0) {
    console.log("Failed: " + failed.map((f) => f.id).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

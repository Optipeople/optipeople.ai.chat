// Answer-correctness eval harness (docs/answer-correctness-plan.md fix H).
//
// Runs golden questions against the REAL chat endpoint, against the REAL
// knowledge base, and asserts on the answer and on which tools the model
// called. There is no mocking here on purpose: every cause of the
// 2026-08-19 wrong-DIP-switch answer lived in the seams between
// extraction, chunking, retrieval and the prompt, and a harness that
// stubs any of those cannot see the bug it exists to catch.
//
// Usage:
//   npm run dev                     # in another terminal
//   EVAL_MACHINE_ID=<machine> npm run eval
//   EVAL_MACHINE_ID=<machine> npm run eval -- nx502-dip-backup
//
// Env:
//   EVAL_MACHINE_ID  default machine for cases that don't name one
//   EVAL_BASE_URL    default http://localhost:3000
//   EVAL_TIMEOUT_MS  per-request ceiling, default 180000
//
// Auth: the harness reads the fixture machine's qr_token straight from
// machine_kb with the service-role key and passes it as X-QR-Token, which
// is the same door the shop-floor sticker uses. No Optipeople login needed.
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
  // quoted the source rather than paraphrasing a value out of it.
  | { type: "quotesSource"; label?: string }
  // A source chip must point at one of these pages.
  | { type: "citesPage"; pages: number[]; label?: string };

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
};

// ---------------------------------------------------------------------------
// Chat client
// ---------------------------------------------------------------------------

type ChatTurn = {
  answer: string;
  toolCalls: string[];
  sources: { id: string; title: string; pageFrom: number | null }[];
  error: string | null;
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
      } else if (event === "error") {
        const p = payload as { message?: string; title?: string };
        turn.error = p.message ?? p.title ?? "unknown error";
      }
    }
  }
  return turn;
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
      return "quoted the source verbatim (code block or table)";
    case "citesPage":
      return `cited page ${a.pages.join(" or ")}`;
  }
}

// A fenced block, or a Markdown table row. Either counts as showing the
// operator the manual's own words instead of a paraphrase.
const QUOTE_RE = /```[\s\S]*?```|^[^\n]*\|[^\n]*\|[^\n]*$/m;

function check(a: Assertion, turn: ChatTurn): Failure | null {
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
    case "quotesSource":
      return QUOTE_RE.test(turn.answer)
        ? null
        : fail("no fenced block and no table row in the answer");
    case "citesPage": {
      const cited = turn.sources
        .map((s) => s.pageFrom)
        .filter((p): p is number => typeof p === "number");
      return cited.some((p) => a.pages.includes(p))
        ? null
        : fail(`cited pages: ${cited.join(", ") || "(none)"}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type CaseResult = {
  id: string;
  about?: string;
  passed: boolean;
  failures: Failure[];
  turns: { answer: string; toolCalls: string[] }[];
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
  if (!machineId) {
    result.error =
      "no machineId on the case and EVAL_MACHINE_ID is not set";
    return result;
  }

  try {
    const qrToken = await qrTokenFor(machineId);
    const messages: WireMessage[] = [{ role: "user", content: c.question }];
    const first = await askChat({ machineId, qrToken, messages });
    result.turns.push({ answer: first.answer, toolCalls: first.toolCalls });
    if (first.error) {
      result.error = `chat error: ${first.error}`;
      return result;
    }
    for (const a of c.assert) {
      const f = check(a, first);
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
      result.turns.push({ answer: second.answer, toolCalls: second.toolCalls });
      if (second.error) {
        result.error = `chat error (pushback): ${second.error}`;
        return result;
      }
      for (const a of c.assertAfterPushback ?? []) {
        const f = check(a, second);
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
      (defaultMachineId ? ` (machine ${defaultMachineId})` : ""),
  );

  const results: CaseResult[] = [];
  // Sequential on purpose: these are real chat turns against one machine's
  // knowledge base, and a stampede of parallel Anthropic calls just trades
  // wall-clock for rate-limit retries.
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const r = await runCase(c, defaultMachineId);
    results.push(r);
    if (r.error) console.log(`ERROR (${r.error})`);
    else if (r.passed) console.log("pass");
    else console.log(`FAIL (${r.failures.length})`);
    for (const f of r.failures) {
      console.log(`      expected: ${f.assertion}`);
      console.log(`      actual:   ${f.detail}`);
    }
  }

  const failed = results.filter((r) => !r.passed);
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
        total: results.length,
        passed: results.length - failed.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `\n${results.length - failed.length}/${results.length} passed. Report: ${outPath}`,
  );
  if (failed.length > 0) {
    console.log("Failed: " + failed.map((f) => f.id).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

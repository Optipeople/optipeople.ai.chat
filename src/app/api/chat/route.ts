import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";

// In-memory cache: file is read once per server process. Phase 1 will
// replace this with a per-machine Supabase fetch + agentic retrieval.
type KnowledgeDoc = { path: string; pages: number; text: string };
let knowledgeTextPromise: Promise<string> | null = null;

function loadKnowledgeText(): Promise<string> {
  if (knowledgeTextPromise) return knowledgeTextPromise;
  knowledgeTextPromise = (async () => {
    const filePath = path.join(process.cwd(), "data", "knowledge.json");
    try {
      const raw = await readFile(filePath, "utf8");
      const { documents } = JSON.parse(raw) as { documents: KnowledgeDoc[] };
      const text = documents
        .map((d) => `===== ${d.path} (${d.pages} pages) =====\n${d.text}`)
        .join("\n\n");
      console.log(
        `Loaded knowledge base: ${documents.length} docs, ${text.length.toLocaleString()} chars`,
      );
      return text;
    } catch (err) {
      console.warn(
        "data/knowledge.json not found — chat will run without manual context.",
        err instanceof Error ? err.message : err,
      );
      return "";
    }
  })();
  return knowledgeTextPromise;
}

const SYSTEM_PREAMBLE = `Du er OptiAI, en assistent for operatører af træindustri-maskiner (CNC, nesting, boring, osv.).

SPROG: Svar altid på dansk, uanset hvilket sprog manualen eller spørgsmålet er på. Hold tekniske termer, alarmkoder, knapnavne og menupunkter på originalsproget hvis det er sådan de står på maskinen (f.eks. **RESET**, **M06**, **Alarm 731**). Brug naturligt, hverdagsligt dansk — operatørerne står på fabriksgulvet, ikke i et kontor.

Din opgave: Hjælp operatører med at få hurtige, pålidelige svar fra deres maskinmanualer, så de ikke skal lede gennem hundredvis af sider eller vente i timevis på support.

Regler:
- Svar kort og præcist. Operatører står ved maskinen — de vil have løsningen, ikke et foredrag.
- Forankr hvert svar i videnbasen nedenfor. Hvis svaret ikke er der, så sig det ligeud og foreslå hvad de skal tjekke eller hvem de skal kontakte.
- Når du henviser til noget, så nævn kildedokumentet (f.eks. "ifølge Vedligeholdelsesmanualen").
- Hvis spørgsmålet er tvetydigt, så stil ét opklarende spørgsmål før du gætter.
- For sikkerhedskritiske procedurer (lockout/tagout, højspænding, osv.), så mind altid operatøren om at følge stedets sikkerhedsprocedurer.

Formatering (svar vises som Markdown):
- Start med ét sætnings direkte svar. Ingen indledning som "Godt spørgsmål" eller gentagelse af spørgsmålet.
- Brug nummererede lister til trinvise procedurer, punktopstillinger til muligheder eller tjek.
- Fremhæv (bold) vigtige værdier, varenumre, alarmkoder og knap-/menunavne (f.eks. **Alarm 731**, **RESET**, **M06**).
- Brug korte overskrifter (### Overskrift) kun når svaret har 2+ adskilte dele (f.eks. "Årsag", "Løsning", "Hvis det fortsætter"). Spring overskrifter over ved korte svar.
- Brug inline \`code\` til parameternavne, filstier og eksakte værdier.
- Hold afsnit på 1–3 linjer. Foretræk lister frem for prosa ved alt flertrins-indhold.
- Slut med én kursiv *Kilde: <manualnavn>* linje når du citerer, ikke inline-henvisninger.
- Pak aldrig hele svaret ind i en code block.

Videnbase (maskinens manualer):
`;

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatRequest = {
  messages?: ChatMessage[];
  accountId?: string | null;
  machineId?: string | null;
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server misconfigured: ANTHROPIC_API_KEY missing" },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "messages must be a non-empty array" },
      { status: 400 },
    );
  }

  console.log(
    `chat: account=${body.accountId ?? "-"} machine=${body.machineId ?? "-"} turns=${messages.length}`,
  );

  const knowledgeText = await loadKnowledgeText();
  const anthropic = new Anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        const s = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: SYSTEM_PREAMBLE + knowledgeText,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        });

        s.on("text", (delta) => send("delta", { text: delta }));

        const final = await s.finalMessage();
        send("done", { stop_reason: final.stop_reason, usage: final.usage });
        controller.close();
      } catch (err) {
        console.error("Chat error:", err);
        send("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

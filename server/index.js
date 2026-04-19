import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MODEL = "claude-sonnet-4-6";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

let knowledgeText;
try {
  const raw = await readFile(join(__dirname, "knowledge.json"), "utf8");
  const { documents } = JSON.parse(raw);
  knowledgeText = documents
    .map((d) => `===== ${d.path} (${d.pages} pages) =====\n${d.text}`)
    .join("\n\n");
  console.log(
    `Loaded knowledge base: ${documents.length} docs, ${knowledgeText.length.toLocaleString()} chars (~${Math.round(knowledgeText.length / 4).toLocaleString()} tokens)`,
  );
} catch (err) {
  console.error(
    "Could not load knowledge.json. Run `npm run extract` first.\n",
    err.message,
  );
  process.exit(1);
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

const anthropic = new Anthropic();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const stream = anthropic.messages.stream({
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

    stream.on("text", (delta) => send("delta", { text: delta }));

    const final = await stream.finalMessage();
    send("done", {
      stop_reason: final.stop_reason,
      usage: final.usage,
    });
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    send("error", { message: err?.message ?? "Unknown error" });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`OptiAI server listening on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL} | prompt caching: on (1h TTL)`);
});

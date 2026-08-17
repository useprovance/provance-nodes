import express from "express";
import { runHoneypotAgent, HoneypotInputSchema } from "./agent";

const app = express();
const PORT = process.env.PORT ?? 3103;

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: "honeypot" });
});

app.post("/run", async (req, res) => {
  try {
    const input = HoneypotInputSchema.parse(req.body ?? {});
    const result = await runHoneypotAgent(input);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[honeypot-agent] running on http://localhost:${PORT}`);
});

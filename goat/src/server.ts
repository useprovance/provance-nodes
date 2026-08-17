import "dotenv/config";
import express from "express";
import { z } from "zod";
import { runGruffAgent } from "./agent";

const app = express();
const PORT = process.env.PORT ?? 3106;

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", agent: "gruff" },
    message: "Gruff is running",
  });
});

const InputSchema = z.object({
  message: z.string().min(1, "message is required"),
});

app.post("/run", async (req, res) => {
  try {
    const { message } = InputSchema.parse(req.body ?? {});
    const result = await runGruffAgent(message);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ success: false, data: {}, message: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[gruff] running on http://localhost:${PORT}`);
});

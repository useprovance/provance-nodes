import dotenv from "dotenv";
import { z } from "zod";

import express from "express";
import {
   runDexScreenerAgent,
   DexScreenerInputSchema,
} from "../nodes/dexscreener/src/agent";
import { runGoPlusAgent, GoPlusInputSchema } from "../nodes/goplus/src/agent";
import {
   runHoneypotAgent,
   HoneypotInputSchema,
} from "../nodes/honeypot/src/agent";
import {
   runAIDecisionAgent,
   AIDecisionInputSchema,
} from "../nodes/ai-decision/src/agent";
import {
   runTelegramAgent,
   TelegramInputSchema,
} from "../nodes/telegram/src/agent";
import { runGruffAgent } from "../nodes/goat/src/agent";
import { runStellarTraderAgent } from "../nodes/blaze/src/agent";

// Load root env first, then each node's own env (override: false = don't overwrite already-set vars)
dotenv.config();
dotenv.config({ path: "./nodes/goat/.env", override: false });
dotenv.config({ path: "./nodes/blaze/.env", override: false });
dotenv.config({ path: "./nodes/ai-decision/.env", override: false });
dotenv.config({ path: "./nodes/telegram/.env", override: false });

const app = express();
const PORT = process.env.PORT ?? 3100;

app.use(express.json());
app.use((_req, res, next) => {
   res.setHeader("Access-Control-Allow-Origin", "*");
   res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
   res.setHeader("Access-Control-Allow-Headers", "Content-Type");
   next();
});
app.options("*", (_req, res) => res.sendStatus(204));

// ─── Health ────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
   res.json({
      success: true,
      data: {
         status: "ok",
         nodes: [
            "dexscreener",
            "goplus",
            "honeypot",
            "ai-decision",
            "telegram",
            "goat",
            "blaze",
         ],
      },
      message: "Provance nodes running",
   });
});

// ─── DexScreener ───────────────────────────────────────────────────────────

app.post("/dexscreener/run", async (req, res) => {
   try {
      const input = DexScreenerInputSchema.parse(req.body ?? {});
      const data = await runDexScreenerAgent(input);
      res.json({ success: true, data, message: "DexScreener scan complete" });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/dexscreener/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "dexscreener" },
      message: "DexScreener is running",
   });
});

// ─── GoPlus ────────────────────────────────────────────────────────────────

app.post("/goplus/run", async (req, res) => {
   try {
      const input = GoPlusInputSchema.parse(req.body ?? {});
      const data = await runGoPlusAgent(input);
      res.json({
         success: true,
         data,
         message: "GoPlus security check complete",
      });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/goplus/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "goplus" },
      message: "GoPlus is running",
   });
});

// ─── Honeypot ──────────────────────────────────────────────────────────────

app.post("/honeypot/run", async (req, res) => {
   try {
      const input = HoneypotInputSchema.parse(req.body ?? {});
      const data = await runHoneypotAgent(input);
      res.json({
         success: true,
         data,
         message: "Honeypot simulation complete",
      });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/honeypot/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "honeypot" },
      message: "Honeypot is running",
   });
});

// ─── AI Decision ───────────────────────────────────────────────────────────

app.post("/ai-decision/run", async (req, res) => {
   try {
      const input = AIDecisionInputSchema.parse(req.body ?? {});
      const data = await runAIDecisionAgent(input);
      res.json({ success: true, data, message: "AI decision complete" });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/ai-decision/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "ai-decision" },
      message: "AI Decision is running",
   });
});

// ─── Telegram ──────────────────────────────────────────────────────────────

app.post("/telegram/run", async (req, res) => {
   try {
      const input = TelegramInputSchema.parse(req.body ?? {});
      const data = await runTelegramAgent(input);
      res.json({ success: true, data, message: "Telegram message sent" });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/telegram/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "telegram" },
      message: "Telegram is running",
   });
});

// ─── Goat (Gruff) ──────────────────────────────────────────────────────────

const MessageSchema = z.object({
   message: z.string().min(1, "message is required"),
});

app.post("/goat/run", async (req, res) => {
   try {
      const { message } = MessageSchema.parse(req.body ?? {});
      const result = await runGruffAgent(message);
      res.json(result);
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/goat/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "goat" },
      message: "Gruff is running",
   });
});

// ─── Blaze (Stellar) ───────────────────────────────────────────────────────

app.post("/blaze/run", async (req, res) => {
   try {
      const { message } = MessageSchema.parse(req.body ?? {});
      const result = await runStellarTraderAgent(message);
      res.json(result);
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
});

app.get("/blaze/health", (_req, res) => {
   res.json({
      success: true,
      data: { status: "ok", node: "blaze" },
      message: "Blaze is running",
   });
});

// ─── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
   console.log(`[provance-nodes] running on http://localhost:${PORT}`);
   console.log(
      `  Nodes: dexscreener | goplus | honeypot | ai-decision | telegram | goat | blaze`,
   );
});

import express from "express";
import { corsMiddleware } from "./middleware/cors";
import goatRouter from "../nodes/goat/goat.route";
import blazeRouter from "../nodes/blaze/blaze.route";
import dexscreenerRouter from "../nodes/dexscreener/dexscreener.route";
import goplusRouter from "../nodes/goplus/goplus.route";
import honeypotRouter from "../nodes/honeypot/honeypot.route";
import aiDecisionRouter from "../nodes/ai-decision/ai-decision.route";
import telegramRouter from "../nodes/telegram/telegram.route";

const app = express();

app.use(express.json());
app.use(corsMiddleware);

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

app.use("/goat", goatRouter);
app.use("/blaze", blazeRouter);
app.use("/dexscreener", dexscreenerRouter);
app.use("/goplus", goplusRouter);
app.use("/honeypot", honeypotRouter);
app.use("/ai-decision", aiDecisionRouter);
app.use("/telegram", telegramRouter);

export default app;

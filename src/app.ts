import express from "express";
import { corsMiddleware } from "./middleware/cors";
import gruffRouter from "../nodes/gruff/gruff.route";
import blazeRouter from "../nodes/blaze/blaze.route";
import dexscreenerRouter from "../nodes/dexscreener/dexscreener.route";
import goplusRouter from "../nodes/goplus/goplus.route";
import honeypotRouter from "../nodes/honeypot/honeypot.route";
import telegramRouter from "../nodes/telegram/telegram.route";
import geckoterminalRouter from "../nodes/geckoterminal/geckoterminal.route";
import openaiRouter from "../nodes/openai/openai.route";
import triggerRouter from "../nodes/core/modules/trigger/trigger.route";

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
        "geckoterminal",
        "goplus",
        "honeypot",
        "telegram",
        "gruff",
        "blaze",
        "openai",
      ],
    },
    message: "Provance nodes running",
  });
});

app.use("/gruff", gruffRouter);
app.use("/blaze", blazeRouter);
app.use("/dexscreener", dexscreenerRouter);
app.use("/geckoterminal", geckoterminalRouter);
app.use("/goplus", goplusRouter);
app.use("/honeypot", honeypotRouter);
app.use("/telegram", telegramRouter);
app.use("/openai", openaiRouter);
app.use("/core/trigger", triggerRouter);

export default app;

import { Router } from "express";
import { runGeckoTerminal } from "./geckoterminal.controller";

const router = Router();

router.post("/run", runGeckoTerminal);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "geckoterminal", actions: ["new_pools", "token_info", "ohlcv", "trades", "trending_pools"] },
    message: "GeckoTerminal is running",
  });
});

export default router;

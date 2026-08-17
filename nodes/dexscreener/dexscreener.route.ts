import { Router } from "express";
import { runDexScreener } from "./dexscreener.controller";

const router = Router();

router.post("/run", runDexScreener);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "dexscreener" },
    message: "DexScreener is running",
  });
});

export default router;

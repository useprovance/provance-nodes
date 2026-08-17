import { Router } from "express";
import { runTelegram } from "./telegram.controller";

const router = Router();

router.post("/run", runTelegram);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "telegram" },
    message: "Telegram is running",
  });
});

export default router;

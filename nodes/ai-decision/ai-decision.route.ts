import { Router } from "express";
import { runAIDecision } from "./ai-decision.controller";

const router = Router();

router.post("/run", runAIDecision);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "ai-decision" },
    message: "AI Decision is running",
  });
});

export default router;

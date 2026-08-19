import { Router } from "express";
import { runTrigger } from "./trigger.controller";

const router = Router();

router.post("/run", runTrigger);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "trigger", actions: ["manual", "schedule", "webhook"] },
    message: "Core trigger is running",
  });
});

export default router;

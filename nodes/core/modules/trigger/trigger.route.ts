import { Router } from "express";
import { runTrigger, registerSchedule, cancelSchedule } from "./trigger.controller";

const router = Router();

router.post("/run", runTrigger);
router.post("/schedule", registerSchedule);
router.delete("/schedule/:workflowId", cancelSchedule);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "trigger", actions: ["manual", "schedule", "webhook"] },
    message: "Core trigger is running",
  });
});

export default router;

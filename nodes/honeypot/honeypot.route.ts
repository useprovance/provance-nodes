import { Router } from "express";
import { runHoneypot } from "./honeypot.controller";

const router = Router();

router.post("/run", runHoneypot);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "honeypot" },
    message: "Honeypot is running",
  });
});

export default router;

import { Router } from "express";
import { runOpenAI } from "./openai.controller";

const router = Router();

router.post("/run", runOpenAI);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "openai", actions: ["run_prompt"] },
    message: "OpenAI node is running",
  });
});

export default router;

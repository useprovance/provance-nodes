import { Request, Response } from "express";
import { runAIDecisionAgent, AIDecisionInputSchema } from "./src/agent";

export async function runAIDecision(req: Request, res: Response): Promise<void> {
  try {
    const input = AIDecisionInputSchema.parse(req.body ?? {});
    const data = await runAIDecisionAgent(input);
    res.json({ success: true, data, message: "AI decision complete" });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

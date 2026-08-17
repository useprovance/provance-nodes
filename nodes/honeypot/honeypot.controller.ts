import { Request, Response } from "express";
import { runHoneypotAgent, HoneypotInputSchema } from "./src/agent";

export async function runHoneypot(req: Request, res: Response): Promise<void> {
  try {
    const input = HoneypotInputSchema.parse(req.body ?? {});
    const data = await runHoneypotAgent(input);
    res.json({ success: true, data, message: "Honeypot simulation complete" });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

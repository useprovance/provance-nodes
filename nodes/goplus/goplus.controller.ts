import { Request, Response } from "express";
import { runGoPlusAgent, GoPlusInputSchema } from "./src/agent";

export async function runGoPlus(req: Request, res: Response): Promise<void> {
  try {
    const input = GoPlusInputSchema.parse(req.body ?? {});
    const data = await runGoPlusAgent(input);
    res.json({ success: true, data, message: "GoPlus security check complete" });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

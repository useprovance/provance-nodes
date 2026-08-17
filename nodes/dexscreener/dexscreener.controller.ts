import { Request, Response } from "express";
import { runDexScreenerAgent, DexScreenerInputSchema } from "./src/agent";

export async function runDexScreener(req: Request, res: Response): Promise<void> {
  try {
    const input = DexScreenerInputSchema.parse(req.body ?? {});
    const data = await runDexScreenerAgent(input);
    res.json({ success: true, data, message: "DexScreener scan complete" });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

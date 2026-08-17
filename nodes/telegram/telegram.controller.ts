import { Request, Response } from "express";
import { runTelegramAgent, TelegramInputSchema } from "./src/agent";

export async function runTelegram(req: Request, res: Response): Promise<void> {
  try {
    const input = TelegramInputSchema.parse(req.body ?? {});
    const data = await runTelegramAgent(input);
    res.json({ success: true, data, message: "Telegram message sent" });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

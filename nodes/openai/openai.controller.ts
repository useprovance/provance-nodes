import { Request, Response } from "express";
import { runPrompt } from "./openai.actions";

export async function runOpenAI(req: Request, res: Response): Promise<void> {
  const { action, ...params } = req.body ?? {};

  try {
    let data: unknown;

    switch (action) {
      case "run_prompt":
        data = await runPrompt(params);
        break;
      default:
        res.status(400).json({ success: false, data: {}, message: `Unknown action: "${action}". Valid actions: run_prompt` });
        return;
    }

    res.json({ success: true, data, message: `OpenAI ${action} complete` });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

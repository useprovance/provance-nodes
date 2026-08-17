import { Request, Response } from "express";
import { gruff } from "./agent/gruff";
import { MessageSchema } from "./goat.schema";

export async function runGruff(req: Request, res: Response): Promise<void> {
  try {
    const { message } = MessageSchema.parse(req.body ?? {});
    const result = await gruff.run(message);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

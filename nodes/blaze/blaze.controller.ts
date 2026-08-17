import { Request, Response } from "express";
import { blaze } from "./agent/blaze";
import { MessageSchema } from "./blaze.schema";

export async function runBlaze(req: Request, res: Response): Promise<void> {
  try {
    const { message } = MessageSchema.parse(req.body ?? {});
    const result = await blaze.run(message);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

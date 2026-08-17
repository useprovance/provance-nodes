import { z } from "zod";

export const MessageSchema = z.object({
  message: z.string().min(1, "message is required"),
});

export type MessageInput = z.infer<typeof MessageSchema>;

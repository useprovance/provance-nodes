import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RunPromptSchema = z.object({
  message: z.string().min(1, "Prompt (message) is required"),
  model: z.string().default("gpt-4o-mini"),
  system_prompt: z.string().optional(),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
});

export async function runPrompt(raw: unknown) {
  const params = RunPromptSchema.parse(raw);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (params.system_prompt) {
    messages.push({ role: "system", content: params.system_prompt });
  }

  messages.push({ role: "user", content: params.message });

  const response = await client.chat.completions.create({
    model: params.model,
    messages,
    temperature: params.temperature,
  });

  const content = response.choices[0]?.message?.content ?? "";

  return {
    response: content,
    model: params.model,
    prompt_tokens: response.usage?.prompt_tokens ?? 0,
    completion_tokens: response.usage?.completion_tokens ?? 0,
    total_tokens: response.usage?.total_tokens ?? 0,
  };
}

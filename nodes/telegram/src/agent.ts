import { z } from "zod";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export const TelegramInputSchema = z.object({
  chat_id: z.string().or(z.number()),

  token_name: z.string().optional().default("Unknown"),
  token_symbol: z.string().optional().default("?"),
  name: z.string().optional(),
  symbol: z.string().optional(),
  token_address: z.string().optional(),
  chain: z.string().default("base"),

  decision: z.enum(["buy", "ignore", "sold"]).optional(),
  confidence: z.coerce.number().optional(),
  reason: z.string().optional(),
  reasoning: z.string().optional(),

  entry_price: z.number().optional(),
  exit_price: z.number().optional(),
  amount_usd: z.number().optional(),
  pnl_usd: z.number().optional(),
  pnl_pct: z.number().optional(),
  tx_hash: z.string().optional(),

  message: z.string().optional(),
}).passthrough(); // keep all unknown fields so applyTemplate can use anything from the workflow

export type TelegramInput = z.infer<typeof TelegramInputSchema>;

export interface TelegramOutput {
  sent: boolean;
  message_id?: number;
  chat_id: string | number;
  text: string;
}

function esc(val: unknown): string {
  return String(val ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function b(text: string) { return `<b>${text}</b>`; }
function a(label: string, url: string) { return `<a href="${url}">${esc(label)}</a>`; }

function formatAlert(input: TelegramInput): string {
  const chain = esc(input.chain.toUpperCase());
  const dexUrl = `https://dexscreener.com/${input.chain}/${input.token_address ?? ""}`;
  const sym = esc(input.token_symbol);
  const name = esc(input.token_name);

  if (input.decision === "sold" && input.pnl_usd !== undefined) {
    const pnlSign = (input.pnl_usd ?? 0) >= 0 ? "+" : "";
    const emoji = (input.pnl_usd ?? 0) >= 0 ? "✅" : "❌";
    return [
      `${emoji} ${b(`TRADE CLOSED — ${sym}`)}`,
      ``,
      `📊 ${b("Result")}`,
      `• Entry: $${esc(input.entry_price?.toFixed(8))}`,
      `• Exit: $${esc(input.exit_price?.toFixed(8))}`,
      `• Invested: $${esc(input.amount_usd)}`,
      `• PnL: ${pnlSign}$${esc(input.pnl_usd?.toFixed(2))} (${pnlSign}${esc(input.pnl_pct?.toFixed(1))}%)`,
      ``,
      `📝 ${b("Reason:")} ${esc(input.reason)}`,
      input.tx_hash ? `🔗 ${a("View tx", `https://basescan.org/tx/${input.tx_hash}`)}` : "",
      `⛓ Chain: ${chain}`,
    ].filter(Boolean).join("\n");
  }

  if (input.decision === "buy") {
    return [
      `🟢 ${b(`BUY SIGNAL — ${sym}`)}`,
      ``,
      `🪙 ${b("Token:")} ${name} (${sym})`,
      `💰 ${b("Amount:")} $${esc(input.amount_usd ?? 50)}`,
      `🎯 ${b("Confidence:")} ${esc(input.confidence)}%`,
      `📝 ${b("Reason:")} ${esc(input.reason)}`,
      ``,
      input.token_address ? `🔍 ${a("DexScreener", dexUrl)}` : "",
      `⛓ Chain: ${chain}`,
    ].filter(Boolean).join("\n");
  }

  // Default fallback
  return `ℹ️ ${name} (${sym}): ${esc(input.reason ?? input.reasoning)}`;
}

function applyTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });
}

export async function runTelegramAgent(input: TelegramInput): Promise<TelegramOutput> {
  const raw = TelegramInputSchema.parse(input);
  const params = {
    ...raw,
    token_name: raw.token_name !== "Unknown" ? raw.token_name : (raw.name ?? "Unknown"),
    token_symbol: raw.token_symbol !== "?" ? raw.token_symbol : (raw.symbol ?? "?"),
    reason: raw.reason ?? raw.reasoning,
  };

  const rawMessage = params.message ? applyTemplate(params.message, params as unknown as Record<string, unknown>) : undefined;
  const text = rawMessage || formatAlert(params);

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chat_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description ?? "Unknown error"}`);
  }

  return {
    sent: true,
    message_id: data.result?.message_id,
    chat_id: params.chat_id,
    text,
  };
}

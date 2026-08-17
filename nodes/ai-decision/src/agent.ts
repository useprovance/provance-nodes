import OpenAI from "openai";
import { z } from "zod";

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Flat schema — all fields come merged from DexScreener + GoPlus + Honeypot parent nodes
export const AIDecisionInputSchema = z.object({
  // Token identity (from DexScreener)
  token_address: z.string().optional().default(""),
  symbol: z.string().optional().default("UNKNOWN"),
  name: z.string().optional().default("Unknown Token"),
  chain: z.string().optional().default("base"),
  price_usd: z.coerce.number().optional().default(0),
  liquidity_usd: z.coerce.number().optional().default(0),
  volume_24h: z.coerce.number().optional().default(0),
  age_minutes: z.coerce.number().optional().default(0),
  dex: z.string().optional().default("unknown"),

  // Static analysis (from GoPlus)
  is_honeypot: z.boolean().optional().default(false),
  owner_renounced: z.boolean().optional().default(false),
  is_open_source: z.boolean().optional().default(false),
  is_mintable: z.boolean().optional().default(false),
  has_blacklist: z.boolean().optional().default(false),
  buy_tax: z.coerce.number().optional().default(0),
  sell_tax: z.coerce.number().optional().default(0),
  top_10_holder_pct: z.coerce.number().optional().default(0),
  risk_level: z.string().optional().default("unknown"),
  risk_flags: z.array(z.string()).optional().default([]),

  // Simulation (from Honeypot.is)
  can_buy: z.boolean().optional().default(true),
  can_sell: z.boolean().optional().default(true),
  flags: z.array(z.string()).optional().default([]),

  // User-configured thresholds
  min_confidence: z.coerce.number().optional().default(70),
  max_sell_tax: z.coerce.number().optional().default(10),
  min_liquidity_usd: z.coerce.number().optional().default(10000),
});

export type AIDecisionInput = z.infer<typeof AIDecisionInputSchema>;

export interface AIDecisionOutput {
  token_address: string | undefined;
  decision: "buy" | "ignore";
  confidence: number;
  reasoning: string;
  hard_rejected: boolean;
  hard_reject_reasons: string[];
  security_score: number;
  liquidity_score: number;
  risk_score: number;
  overall_score: number;
}

function hardRejectCheck(p: AIDecisionInput): string[] {
  const reasons: string[] = [];
  if (p.is_honeypot) reasons.push("Honeypot detected by static analysis");
  if (!p.can_sell) reasons.push("Token cannot be sold (simulation failed)");
  if (p.sell_tax > p.max_sell_tax!) reasons.push(`Sell tax too high: ${p.sell_tax.toFixed(1)}%`);
  if (p.liquidity_usd < p.min_liquidity_usd!) reasons.push(`Liquidity too low: $${p.liquidity_usd.toLocaleString()}`);
  if (p.top_10_holder_pct > 80) reasons.push(`Top 10 holders own ${p.top_10_holder_pct.toFixed(1)}% of supply`);
  return reasons;
}

export async function runAIDecisionAgent(input: AIDecisionInput): Promise<AIDecisionOutput> {
  const p = AIDecisionInputSchema.parse(input);

  const hardRejectReasons = hardRejectCheck(p);
  if (hardRejectReasons.length > 0) {
    return {
      token_address: p.token_address,
      decision: "ignore",
      confidence: 100,
      reasoning: `Hard rejected: ${hardRejectReasons.join("; ")}`,
      hard_rejected: true,
      hard_reject_reasons: hardRejectReasons,
      security_score: 0,
      liquidity_score: 0,
      risk_score: 100,
      overall_score: 0,
    };
  }

  const prompt = `You are a DeFi trading risk analyst for an autonomous token trading bot.
Analyze this token and decide whether to BUY or IGNORE.

TOKEN: ${p.name} (${p.symbol}) on ${p.chain}
Address: ${p.token_address}

MARKET DATA:
- Price: $${p.price_usd}
- Liquidity: $${p.liquidity_usd.toLocaleString()}
- 24h Volume: $${p.volume_24h.toLocaleString()}
- Age: ${p.age_minutes} minutes
- DEX: ${p.dex}

STATIC SECURITY (GoPlus):
- Honeypot: ${p.is_honeypot}
- Ownership renounced: ${p.owner_renounced}
- Open source: ${p.is_open_source}
- Mintable: ${p.is_mintable}
- Blacklist function: ${p.has_blacklist}
- Buy tax: ${p.buy_tax}%  |  Sell tax: ${p.sell_tax}%
- Top 10 holders: ${p.top_10_holder_pct.toFixed(1)}%
- Risk level: ${p.risk_level}
- Risk flags: ${p.risk_flags.join(", ") || "none"}

SIMULATION (Honeypot.is):
- Can buy: ${p.can_buy}  |  Can sell: ${p.can_sell}
- Flags: ${p.flags.join(", ") || "none"}

Respond ONLY with valid JSON:
{
  "decision": "buy" or "ignore",
  "confidence": <0-100>,
  "reasoning": "<one concise sentence>",
  "analysis": {
    "security_score": <0-100>,
    "liquidity_score": <0-100>,
    "risk_score": <0-100>,
    "overall_score": <0-100>
  }
}`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(response.choices[0].message.content ?? "{}");
  const confidence: number = raw.confidence ?? 50;
  const meetsThreshold = confidence >= (p.min_confidence ?? 70);
  const decision: "buy" | "ignore" = raw.decision === "buy" && meetsThreshold ? "buy" : "ignore";

  return {
    token_address: p.token_address,
    decision,
    confidence,
    reasoning: raw.reasoning ?? raw.reason ?? "No reasoning provided",
    hard_rejected: false,
    hard_reject_reasons: [],
    security_score: raw.analysis?.security_score ?? 0,
    liquidity_score: raw.analysis?.liquidity_score ?? 0,
    risk_score: raw.analysis?.risk_score ?? 0,
    overall_score: raw.analysis?.overall_score ?? 0,
  };
}

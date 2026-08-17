import { z } from "zod";

// GoPlus chain IDs (different from DexScreener)
const CHAIN_ID_MAP: Record<string, string> = {
  base: "8453",
  ethereum: "1",
  bsc: "56",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
};

export const GoPlusInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().default("base"),
  min_risk_level: z.string().optional(),
});

export type GoPlusInput = z.infer<typeof GoPlusInputSchema>;

export interface GoPlusOutput {
  token_address: string;
  chain: string;

  // Security flags
  is_honeypot: boolean;
  owner_renounced: boolean;
  is_open_source: boolean;
  is_proxy: boolean;
  is_mintable: boolean;
  can_take_back_ownership: boolean;
  has_blacklist: boolean;
  has_whitelist: boolean;
  is_anti_whale: boolean;
  trading_cooldown: boolean;
  is_airdrop_scam: boolean;
  fake_token: boolean;

  // Tax
  buy_tax: number;
  sell_tax: number;

  // Holders
  holder_count: number;
  lp_holder_count: number;
  top_10_holder_pct: number;
  creator_pct: number;
  owner_pct: number;

  // Summary
  risk_level: "low" | "medium" | "high" | "critical";
  risk_flags: string[];
  passed: boolean;
}

interface GoPlusRawResult {
  is_honeypot?: string;
  owner_address?: string;
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  can_take_back_ownership?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  is_anti_whale?: string;
  trading_cooldown?: string;
  is_airdrop_scam?: string;
  fake_token?: string;
  buy_tax?: string;
  sell_tax?: string;
  holder_count?: string;
  lp_holder_count?: string;
  holders?: Array<{ percent: string; is_contract?: number; is_locked?: number }>;
  lp_holders?: Array<{ percent: string }>;
  creator_address?: string;
  creator_percent?: string;
  owner_percent?: string;
  token_name?: string;
  token_symbol?: string;
}

function toBoolean(val: string | undefined): boolean {
  return val === "1";
}

function toNumber(val: string | undefined): number {
  return parseFloat(val ?? "0") || 0;
}

export async function runGoPlusAgent(input: GoPlusInput): Promise<GoPlusOutput> {
  const params = GoPlusInputSchema.parse(input);
  const chainId = CHAIN_ID_MAP[params.chain] ?? "8453";

  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${params.token_address.toLowerCase()}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`GoPlus API error: ${res.status}`);
  }

  const data = await res.json();

  if (data.code !== 1) {
    throw new Error(`GoPlus error: ${data.message ?? "Unknown error"}`);
  }

  const raw: GoPlusRawResult = data.result?.[params.token_address.toLowerCase()] ?? {};

  const isHoneypot = toBoolean(raw.is_honeypot);
  const ownerRenounced =
    !raw.owner_address || raw.owner_address === "0x0000000000000000000000000000000000000000";
  const buyTax = toNumber(raw.buy_tax) * 100;
  const sellTax = toNumber(raw.sell_tax) * 100;
  const top10Pct =
    (raw.holders?.slice(0, 10).reduce((sum, h) => sum + toNumber(h.percent), 0) ?? 0) * 100;
  const creatorPct = toNumber(raw.creator_percent) * 100;
  const ownerPct = toNumber(raw.owner_percent) * 100;

  // Build risk flags
  const riskFlags: string[] = [];
  if (isHoneypot) riskFlags.push("Honeypot detected");
  if (!ownerRenounced) riskFlags.push("Ownership not renounced");
  if (!toBoolean(raw.is_open_source)) riskFlags.push("Contract not verified");
  if (toBoolean(raw.is_mintable)) riskFlags.push("Token is mintable");
  if (toBoolean(raw.can_take_back_ownership)) riskFlags.push("Owner can be reclaimed");
  if (toBoolean(raw.is_blacklisted)) riskFlags.push("Has blacklist function");
  if (buyTax > 10) riskFlags.push(`High buy tax: ${buyTax.toFixed(1)}%`);
  if (sellTax > 10) riskFlags.push(`High sell tax: ${sellTax.toFixed(1)}%`);
  if (top10Pct > 50) riskFlags.push(`Top 10 holders own ${top10Pct.toFixed(1)}%`);
  if (toBoolean(raw.fake_token)) riskFlags.push("Fake token detected");

  // Determine risk level
  let riskLevel: GoPlusOutput["risk_level"];
  const criticalFlags = [isHoneypot, toBoolean(raw.fake_token), sellTax > 50];
  const highFlags = [!ownerRenounced, toBoolean(raw.can_take_back_ownership), sellTax > 10];

  if (criticalFlags.some(Boolean)) riskLevel = "critical";
  else if (highFlags.filter(Boolean).length >= 2) riskLevel = "high";
  else if (riskFlags.length >= 2) riskLevel = "medium";
  else riskLevel = "low";

  const passed =
    !isHoneypot &&
    !toBoolean(raw.fake_token) &&
    sellTax <= 10 &&
    buyTax <= 10;

  return {
    token_address: params.token_address,
    chain: params.chain,
    is_honeypot: isHoneypot,
    owner_renounced: ownerRenounced,
    is_open_source: toBoolean(raw.is_open_source),
    is_proxy: toBoolean(raw.is_proxy),
    is_mintable: toBoolean(raw.is_mintable),
    can_take_back_ownership: toBoolean(raw.can_take_back_ownership),
    has_blacklist: toBoolean(raw.is_blacklisted),
    has_whitelist: toBoolean(raw.is_whitelisted),
    is_anti_whale: toBoolean(raw.is_anti_whale),
    trading_cooldown: toBoolean(raw.trading_cooldown),
    is_airdrop_scam: toBoolean(raw.is_airdrop_scam),
    fake_token: toBoolean(raw.fake_token),
    buy_tax: buyTax,
    sell_tax: sellTax,
    holder_count: parseInt(raw.holder_count ?? "0"),
    lp_holder_count: parseInt(raw.lp_holder_count ?? "0"),
    top_10_holder_pct: top10Pct,
    creator_pct: creatorPct,
    owner_pct: ownerPct,
    risk_level: riskLevel,
    risk_flags: riskFlags,
    passed,
  };
}

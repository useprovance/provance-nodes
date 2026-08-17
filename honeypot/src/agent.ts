import { z } from "zod";

// Honeypot.is numeric chain IDs
const CHAIN_ID_MAP: Record<string, string> = {
  ethereum: "1",
  eth: "1",
  bsc: "56",
  binance: "56",
  polygon: "137",
  matic: "137",
  arbitrum: "42161",
  arb: "42161",
  optimism: "10",
  base: "8453",
  avalanche: "43114",
  avax: "43114",
};

export const HoneypotInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().default("base"),
});

export type HoneypotInput = z.infer<typeof HoneypotInputSchema>;

export interface HoneypotOutput {
  token_address: string;
  chain: string;

  // Simulation results
  can_buy: boolean;
  can_sell: boolean;
  is_honeypot: boolean;

  // Tax from simulation (more accurate than static analysis)
  buy_tax: number;
  sell_tax: number;
  transfer_tax: number;

  // Gas
  buy_gas_used: number;
  sell_gas_used: number;

  // Token info
  name: string;
  symbol: string;
  decimals: number;
  total_supply: string;

  // Pair info
  pair_address: string;
  router: string;

  // Flags
  flags: string[];
  honeypot_reason: string | null;

  // Summary
  passed: boolean;
  risk_level: "low" | "medium" | "high" | "critical";
  not_indexed?: boolean;
}

export async function runHoneypotAgent(input: HoneypotInput): Promise<HoneypotOutput> {
  const params = HoneypotInputSchema.parse(input);
  const chainId = CHAIN_ID_MAP[params.chain.toLowerCase()] ?? "8453";

  const url = `https://api.honeypot.is/v2/IsHoneypot?address=${params.token_address}&chainID=${chainId}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    if (res.status === 404) {
      // Token not indexed yet — too new. Return unknown/unverified result so workflow continues.
      return {
        token_address: params.token_address,
        chain: params.chain,
        can_buy: false,
        can_sell: false,
        is_honeypot: false,
        buy_tax: 0,
        sell_tax: 0,
        transfer_tax: 0,
        buy_gas_used: 0,
        sell_gas_used: 0,
        name: "",
        symbol: "",
        decimals: 18,
        total_supply: "0",
        pair_address: "",
        router: "",
        flags: ["not_indexed"],
        honeypot_reason: null,
        passed: false,
        risk_level: "high",
        not_indexed: true,
      };
    }
    throw new Error(`Honeypot.is API error: ${res.status}`);
  }

  const data = await res.json();

  const honeypotResult = data.honeypotResult ?? {};
  const simulationResult = data.simulationResult ?? {};
  const token = data.token ?? {};
  const pair = data.pair ?? {};
  const flags: string[] = (data.flags ?? []).map((f: { flag: string }) => f.flag);

  const isHoneypot: boolean = honeypotResult.isHoneypot ?? false;
  const canBuy: boolean = !simulationResult.buyError;
  const canSell: boolean = !simulationResult.sellError;
  const buyTax: number = (simulationResult.buyTax ?? 0) * 100;
  const sellTax: number = (simulationResult.sellTax ?? 0) * 100;
  const transferTax: number = (simulationResult.transferTax ?? 0) * 100;

  const riskFlags: string[] = [];
  if (isHoneypot) riskFlags.push("Honeypot confirmed by simulation");
  if (!canSell) riskFlags.push(`Cannot sell: ${simulationResult.sellError ?? "unknown"}`);
  if (!canBuy) riskFlags.push(`Cannot buy: ${simulationResult.buyError ?? "unknown"}`);
  if (sellTax > 10) riskFlags.push(`High sell tax: ${sellTax.toFixed(1)}%`);
  if (buyTax > 10) riskFlags.push(`High buy tax: ${buyTax.toFixed(1)}%`);

  let riskLevel: HoneypotOutput["risk_level"];
  if (isHoneypot || !canSell) riskLevel = "critical";
  else if (sellTax > 20 || !canBuy) riskLevel = "high";
  else if (sellTax > 10 || buyTax > 10) riskLevel = "medium";
  else riskLevel = "low";

  const passed = canBuy && canSell && !isHoneypot && sellTax <= 10 && buyTax <= 10;

  return {
    token_address: params.token_address,
    chain: params.chain,
    can_buy: canBuy,
    can_sell: canSell,
    is_honeypot: isHoneypot,
    buy_tax: buyTax,
    sell_tax: sellTax,
    transfer_tax: transferTax,
    buy_gas_used: simulationResult.buyGasUsed ?? 0,
    sell_gas_used: simulationResult.sellGasUsed ?? 0,
    name: token.name ?? "",
    symbol: token.symbol ?? "",
    decimals: token.decimals ?? 18,
    total_supply: token.totalSupply ?? "0",
    pair_address: pair.pair?.address ?? "",
    router: pair.router ?? "",
    flags,
    honeypot_reason: honeypotResult.honeypotReason ?? null,
    passed,
    risk_level: riskLevel,
  };
}

import { z } from "zod";

const CHAIN_MAP: Record<string, string> = {
  ethereum: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon",
  avalanche: "avax",
  solana: "solana",
  goat: "goat",
  "goat network": "goat",
};

export function resolveChain(chain: string): string {
  return CHAIN_MAP[chain.toLowerCase()] ?? chain;
}

export const NewPoolsSchema = z.object({
  chain: z.string().default("base"),
  min_liquidity_usd: z.coerce.number().default(10000),
  max_age_minutes: z.coerce.number().default(2880),
  limit: z.coerce.number().default(10),
});

export const TokenInfoSchema = z.object({
  chain: z.string().default("base"),
  token_address: z.string().min(1),
});

export const OhlcvSchema = z.object({
  chain: z.string().default("base"),
  pool_address: z.string().min(1),
  timeframe: z.enum(["minute", "hour", "day"]).default("hour"),
  aggregate: z.coerce.number().default(1),
  limit: z.coerce.number().default(100),
});

export const TradesSchema = z.object({
  chain: z.string().default("base"),
  pool_address: z.string().min(1),
});

export const TrendingPoolsSchema = z.object({
  chain: z.string().default("base"),
  order: z.enum(["h24_volume_usd_desc", "h24_tx_count_desc"]).default("h24_volume_usd_desc"),
  limit: z.coerce.number().default(10),
});

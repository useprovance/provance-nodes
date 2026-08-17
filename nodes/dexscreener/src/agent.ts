import { z } from "zod";

const BASE = "https://api.geckoterminal.com/api/v2";

// GeckoTerminal chain IDs differ slightly from DexScreener's
const CHAIN_MAP: Record<string, string> = {
  ethereum: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon",
  avalanche: "avax",
  solana: "solana",
};

export const DexScreenerInputSchema = z.object({
  chain: z.string().default("bsc"),
  min_liquidity_usd: z.coerce.number().default(1000),
  max_age_minutes: z.coerce.number().default(2880),
  limit: z.coerce.number().default(10),
});

export type DexScreenerInput = z.infer<typeof DexScreenerInputSchema>;

export interface TokenResult {
  token_address: string;
  pair_address: string;
  name: string;
  symbol: string;
  price_usd: number;
  liquidity_usd: number;
  volume_24h: number;
  age_hours: number;
  age_minutes: number;
  dex: string;
  url: string;
  chain: string;
}

export interface DexScreenerOutput {
  tokens: TokenResult[];
  scanned_at: string;
  total_found: number;
}

interface GeckoPool {
  id: string;
  attributes: {
    name: string;
    address: string;
    pool_created_at: string;
    reserve_in_usd: string;
    base_token_price_usd: string;
    volume_usd: { h24: string };
  };
  relationships: {
    base_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}

interface GeckoToken {
  id: string;
  type: "token";
  attributes: { symbol: string; name: string; address: string };
}

const SKIP_SYMBOLS = new Set([
  "USDC", "USDT", "DAI", "USDbC", "WETH", "ETH", "WBTC",
  "WBNB", "BNB", "BUSD", "cbETH", "cbBTC", "SOL", "XRP",
  "BTC", "WBASE",
]);

async function fetchNewPools(network: string, page = 1): Promise<{ pools: GeckoPool[]; included: GeckoToken[] }> {
  const url = `${BASE}/networks/${network}/new_pools?page=${page}&include=base_token`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { pools: [], included: [] };
  const data = await res.json() as { data?: GeckoPool[]; included?: unknown[] };
  const pools = Array.isArray(data.data) ? data.data : [];
  const included = (Array.isArray(data.included) ? data.included : []).filter(
    (item): item is GeckoToken => (item as GeckoToken).type === "token"
  );
  return { pools, included };
}

export async function runDexScreenerAgent(
  input: DexScreenerInput
): Promise<DexScreenerOutput> {
  const params = DexScreenerInputSchema.parse(input);
  const now = Date.now();
  const maxAgeMs = params.max_age_minutes * 60 * 1000;
  const network = CHAIN_MAP[params.chain] ?? params.chain;

  // Fetch up to 3 pages in parallel to get enough candidates
  const pages = await Promise.allSettled([
    fetchNewPools(network, 1),
    fetchNewPools(network, 2),
    fetchNewPools(network, 3),
  ]);

  const allPools: GeckoPool[] = [];
  const tokenMap = new Map<string, GeckoToken["attributes"]>();

  for (const result of pages) {
    if (result.status !== "fulfilled") continue;
    allPools.push(...result.value.pools);
    for (const token of result.value.included) {
      tokenMap.set(token.id, token.attributes);
    }
  }

  const tokens: TokenResult[] = allPools
    .filter((pool) => {
      const createdAt = pool.attributes.pool_created_at
        ? new Date(pool.attributes.pool_created_at).getTime()
        : null;
      if (!createdAt) return false;
      if (now - createdAt > maxAgeMs) return false;
      const liquidity = parseFloat(pool.attributes.reserve_in_usd ?? "0");
      if (liquidity < params.min_liquidity_usd) return false;
      const baseTokenId = pool.relationships.base_token.data.id;
      const tokenInfo = tokenMap.get(baseTokenId);
      if (tokenInfo && SKIP_SYMBOLS.has(tokenInfo.symbol)) return false;
      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.attributes.pool_created_at).getTime();
      const bTime = new Date(b.attributes.pool_created_at).getTime();
      return bTime - aTime;
    })
    .slice(0, params.limit)
    .map((pool) => {
      const baseTokenId = pool.relationships.base_token.data.id;
      const tokenInfo = tokenMap.get(baseTokenId);
      const tokenAddress = baseTokenId.replace(/^[^_]+_/, "");
      const createdAt = new Date(pool.attributes.pool_created_at).getTime();
      const ageMs = now - createdAt;
      return {
        token_address: tokenInfo?.address ?? tokenAddress,
        pair_address: pool.attributes.address,
        name: tokenInfo?.name ?? pool.attributes.name.split(" / ")[0],
        symbol: tokenInfo?.symbol ?? pool.attributes.name.split(" / ")[0],
        price_usd: parseFloat(pool.attributes.base_token_price_usd ?? "0"),
        liquidity_usd: parseFloat(pool.attributes.reserve_in_usd ?? "0"),
        volume_24h: parseFloat(pool.attributes.volume_usd?.h24 ?? "0"),
        age_hours: Math.round((ageMs / 3600000) * 10) / 10,
        age_minutes: Math.round(ageMs / 60000),
        dex: pool.relationships.dex.data.id,
        url: `https://dexscreener.com/${params.chain}/${pool.attributes.address}`,
        chain: params.chain,
      };
    });

  return {
    tokens,
    scanned_at: new Date().toISOString(),
    total_found: tokens.length,
  };
}

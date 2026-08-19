import {
  resolveChain,
  NewPoolsSchema,
  TokenInfoSchema,
  OhlcvSchema,
  TradesSchema,
  TrendingPoolsSchema,
} from "./geckoterminal.schema";

const BASE = "https://api.geckoterminal.com/api/v2";
const HEADERS = { Accept: "application/json;version=20230302" };

const SKIP_SYMBOLS = new Set([
  "USDC", "USDT", "DAI", "USDbC", "WETH", "ETH", "WBTC",
  "WBNB", "BNB", "BUSD", "cbETH", "cbBTC", "SOL", "XRP", "BTC",
]);

async function get(url: string) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GeckoTerminal API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// ─── new_pools ────────────────────────────────────────────────────────────────

export async function newPools(raw: unknown) {
  const params = NewPoolsSchema.parse(raw);
  const network = resolveChain(params.chain);
  const now = Date.now();
  const maxAgeMs = params.max_age_minutes * 60 * 1000;

  const pages = await Promise.allSettled([
    get(`${BASE}/networks/${network}/new_pools?page=1&include=base_token`),
    get(`${BASE}/networks/${network}/new_pools?page=2&include=base_token`),
    get(`${BASE}/networks/${network}/new_pools?page=3&include=base_token`),
  ]);

  const allPools: unknown[] = [];
  const tokenMap = new Map<string, { symbol: string; name: string; address: string }>();

  for (const result of pages) {
    if (result.status !== "fulfilled") continue;
    const data = result.value as { data?: unknown[]; included?: unknown[] };
    if (Array.isArray(data.data)) allPools.push(...data.data);
    for (const item of data.included ?? []) {
      const t = item as { type: string; id: string; attributes: { symbol: string; name: string; address: string } };
      if (t.type === "token") tokenMap.set(t.id, t.attributes);
    }
  }

  const tokens = (allPools as {
    attributes: { pool_created_at: string; reserve_in_usd: string; base_token_price_usd: string; volume_usd: { h24: string }; address: string; name: string };
    relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
  }[])
    .filter((pool) => {
      const createdAt = pool.attributes.pool_created_at ? new Date(pool.attributes.pool_created_at).getTime() : null;
      if (!createdAt || now - createdAt > maxAgeMs) return false;
      if (parseFloat(pool.attributes.reserve_in_usd ?? "0") < params.min_liquidity_usd) return false;
      const tokenInfo = tokenMap.get(pool.relationships.base_token.data.id);
      if (tokenInfo && SKIP_SYMBOLS.has(tokenInfo.symbol)) return false;
      return true;
    })
    .sort((a, b) => new Date(b.attributes.pool_created_at).getTime() - new Date(a.attributes.pool_created_at).getTime())
    .slice(0, params.limit)
    .map((pool) => {
      const tokenId = pool.relationships.base_token.data.id;
      const tokenInfo = tokenMap.get(tokenId);
      const tokenAddress = tokenId.replace(/^[^_]+_/, "");
      const ageMs = now - new Date(pool.attributes.pool_created_at).getTime();
      return {
        token_address: tokenInfo?.address ?? tokenAddress,
        pair_address: pool.attributes.address,
        name: tokenInfo?.name ?? pool.attributes.name.split(" / ")[0],
        symbol: tokenInfo?.symbol ?? pool.attributes.name.split(" / ")[0],
        price_usd: parseFloat(pool.attributes.base_token_price_usd ?? "0"),
        liquidity_usd: parseFloat(pool.attributes.reserve_in_usd ?? "0"),
        volume_24h: parseFloat(pool.attributes.volume_usd?.h24 ?? "0"),
        age_minutes: Math.round(ageMs / 60000),
        age_hours: Math.round((ageMs / 3600000) * 10) / 10,
        dex: pool.relationships.dex.data.id,
        url: `https://www.geckoterminal.com/${params.chain}/pools/${pool.attributes.address}`,
        chain: params.chain,
      };
    });

  return { tokens, total_found: tokens.length, scanned_at: new Date().toISOString() };
}

// ─── token_info ───────────────────────────────────────────────────────────────

export async function tokenInfo(raw: unknown) {
  const params = TokenInfoSchema.parse(raw);
  const network = resolveChain(params.chain);

  const [tokenData, poolsData] = await Promise.all([
    get(`${BASE}/networks/${network}/tokens/${params.token_address}`),
    get(`${BASE}/networks/${network}/tokens/${params.token_address}/pools?page=1`),
  ]);

  const t = (tokenData as { data: { attributes: Record<string, unknown> } }).data.attributes;
  const pools = (poolsData as { data: unknown[] }).data.slice(0, 5).map((p) => {
    const pool = p as { attributes: { address: string; name: string; reserve_in_usd: string; base_token_price_usd: string; volume_usd: { h24: string } }; relationships: { dex: { data: { id: string } } } };
    return {
      address: pool.attributes.address,
      name: pool.attributes.name,
      dex: pool.relationships.dex.data.id,
      liquidity_usd: parseFloat(pool.attributes.reserve_in_usd ?? "0"),
      price_usd: parseFloat(pool.attributes.base_token_price_usd ?? "0"),
      volume_24h: parseFloat(pool.attributes.volume_usd?.h24 ?? "0"),
    };
  });

  return {
    token_address: params.token_address,
    chain: params.chain,
    name: t.name,
    symbol: t.symbol,
    price_usd: parseFloat((t.price_usd as string) ?? "0"),
    fdv_usd: parseFloat((t.fdv_usd as string) ?? "0"),
    market_cap_usd: parseFloat((t.market_cap_usd as string) ?? "0"),
    volume_24h: parseFloat(((t.volume_usd as Record<string, string>)?.h24) ?? "0"),
    top_pools: pools,
  };
}

// ─── ohlcv ────────────────────────────────────────────────────────────────────

export async function ohlcv(raw: unknown) {
  const params = OhlcvSchema.parse(raw);
  const network = resolveChain(params.chain);

  const data = await get(
    `${BASE}/networks/${network}/pools/${params.pool_address}/ohlcv/${params.timeframe}?aggregate=${params.aggregate}&limit=${params.limit}`
  ) as { data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } };

  const candles = (data.data.attributes.ohlcv_list ?? []).map(([timestamp, open, high, low, close, volume]) => ({
    timestamp: new Date(timestamp * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume,
  }));

  return {
    pool_address: params.pool_address,
    chain: params.chain,
    timeframe: params.timeframe,
    aggregate: params.aggregate,
    candles,
    total: candles.length,
  };
}

// ─── trades ───────────────────────────────────────────────────────────────────

export async function trades(raw: unknown) {
  const params = TradesSchema.parse(raw);
  const network = resolveChain(params.chain);

  const data = await get(
    `${BASE}/networks/${network}/pools/${params.pool_address}/trades`
  ) as { data: { attributes: Record<string, unknown> }[] };

  const tradeList = (data.data ?? []).map((t) => ({
    tx_hash: t.attributes.tx_hash,
    timestamp: t.attributes.block_timestamp,
    kind: t.attributes.kind,
    price_usd: parseFloat((t.attributes.price_from_in_usd as string) ?? "0"),
    volume_usd: parseFloat((t.attributes.volume_in_usd as string) ?? "0"),
    from_token_amount: t.attributes.from_token_amount,
    to_token_amount: t.attributes.to_token_amount,
  }));

  return {
    pool_address: params.pool_address,
    chain: params.chain,
    trades: tradeList,
    total: tradeList.length,
  };
}

// ─── trending_pools ───────────────────────────────────────────────────────────

export async function trendingPools(raw: unknown) {
  const params = TrendingPoolsSchema.parse(raw);
  const network = resolveChain(params.chain);

  const data = await get(
    `${BASE}/networks/${network}/trending_pools?include=base_token&page=1`
  ) as { data: unknown[]; included?: unknown[] };

  const tokenMap = new Map<string, { symbol: string; name: string; address: string }>();
  for (const item of data.included ?? []) {
    const t = item as { type: string; id: string; attributes: { symbol: string; name: string; address: string } };
    if (t.type === "token") tokenMap.set(t.id, t.attributes);
  }

  const pools = (data.data as {
    attributes: { address: string; name: string; reserve_in_usd: string; base_token_price_usd: string; volume_usd: { h24: string }; transactions: { h24: { buys: number; sells: number } } };
    relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
  }[])
    .slice(0, params.limit)
    .map((pool) => {
      const tokenInfo = tokenMap.get(pool.relationships.base_token.data.id);
      return {
        pool_address: pool.attributes.address,
        name: pool.attributes.name,
        token_symbol: tokenInfo?.symbol ?? "",
        token_address: tokenInfo?.address ?? "",
        dex: pool.relationships.dex.data.id,
        price_usd: parseFloat(pool.attributes.base_token_price_usd ?? "0"),
        liquidity_usd: parseFloat(pool.attributes.reserve_in_usd ?? "0"),
        volume_24h: parseFloat(pool.attributes.volume_usd?.h24 ?? "0"),
        buys_24h: pool.attributes.transactions?.h24?.buys ?? 0,
        sells_24h: pool.attributes.transactions?.h24?.sells ?? 0,
        chain: params.chain,
      };
    });

  return { pools, total: pools.length, chain: params.chain };
}

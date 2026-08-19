import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  IS_TESTNET,
  goatChain,
  OKU_SWAP_ROUTER,
  OKU_QUOTER,
  KNOWN_TOKENS,
  KNOWN_TOKENS_UPPER,
  ERC20_ABI,
  QUOTER_ABI,
  SWAP_ROUTER_ABI,
} from "./gruff.constants";
import { GetPortfolioSchema, SellPositionSchema } from "./gruff.schema";
import { z } from "zod";

function getClients() {
  const privateKey = process.env.GOAT_PRIVATE_KEY;
  if (!privateKey) throw new Error("GOAT_PRIVATE_KEY is not set");
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: goatChain, transport: http() });
  const walletClient = createWalletClient({ chain: goatChain, transport: http(), account });
  return { account, publicClient, walletClient };
}

function resolveAddress(symbol: string): Hex {
  const upper = symbol.toUpperCase();
  if (KNOWN_TOKENS_UPPER[upper]) return KNOWN_TOKENS_UPPER[upper];
  if (/^0x[0-9a-fA-F]{40}$/.test(symbol)) return symbol as Hex;
  throw new Error(`Unknown token "${symbol}". Known tokens: ${Object.keys(KNOWN_TOKENS).join(", ")}`);
}

// ─── get_portfolio ────────────────────────────────────────────────────────────

export async function getPortfolio(raw: z.infer<typeof GetPortfolioSchema>) {
  const { account, publicClient } = getClients();

  const nativeRaw = await publicClient.getBalance({ address: account.address });
  const nativeBalance = formatUnits(nativeRaw, 18);

  const tokenEntries = Object.entries(KNOWN_TOKENS) as [string, Hex][];
  const extraAddresses: Hex[] = (raw.extra_tokens ?? [])
    .filter((t): t is string => typeof t === "string" && /^0x[0-9a-fA-F]{40}$/.test(t))
    .map((t) => t as Hex);

  const knownResults = await Promise.allSettled(
    tokenEntries.map(async ([symbol, address]) => {
      const [rawBalance, decimals] = await Promise.all([
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
      ]);
      return {
        symbol,
        address,
        balance: formatUnits(rawBalance as bigint, decimals as number),
        has_balance: (rawBalance as bigint) > 0n,
      };
    })
  );

  const extraResults = await Promise.allSettled(
    extraAddresses.map(async (address) => {
      const [rawBalance, decimals, symbol] = await Promise.all([
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
      ]);
      return {
        symbol: symbol as string,
        address,
        balance: formatUnits(rawBalance as bigint, decimals as number),
        has_balance: (rawBalance as bigint) > 0n,
      };
    })
  );

  type TokenEntry = { symbol: string; address: Hex; balance: string; has_balance: boolean };
  const tokens: TokenEntry[] = [
    ...knownResults.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<TokenEntry>).value),
    ...extraResults.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<TokenEntry>).value),
  ];

  return {
    wallet_address: account.address,
    network: IS_TESTNET ? "testnet" : "mainnet",
    native: { symbol: "BTC", balance: nativeBalance },
    tokens,
    tokens_with_balance: tokens.filter((t) => t.has_balance).length,
    scanned_at: new Date().toISOString(),
  };
}

// ─── sell_position ────────────────────────────────────────────────────────────

export async function sellPosition(raw: z.infer<typeof SellPositionSchema>) {
  if (IS_TESTNET) throw new Error("OKU DEX is not on testnet. Switch to mainnet to sell.");

  const { account, publicClient, walletClient } = getClients();
  const tokenIn = resolveAddress(raw.token);
  const tokenOut = resolveAddress(raw.to_token);

  const decimalsIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as number;

  let amountIn: bigint;
  if (raw.amount) {
    amountIn = parseUnits(raw.amount, decimalsIn);
  } else {
    const fullBalance = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }) as bigint;
    if (fullBalance === 0n) throw new Error(`Wallet has no balance of ${raw.token}`);
    amountIn = fullBalance;
  }

  const symbolIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "symbol" }) as string;

  const [amountOut] = await publicClient.readContract({
    address: OKU_QUOTER,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: raw.fee_tier, sqrtPriceLimitX96: BigInt(0) }],
  }) as [bigint, bigint, number, bigint];

  const amountOutMin = (amountOut * BigInt(10000 - raw.slippage_bps)) / BigInt(10000);

  const allowance = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "allowance", args: [account.address, OKU_SWAP_ROUTER] }) as bigint;
  if (allowance < amountIn) {
    const approveTx = await walletClient.writeContract({ address: tokenIn, abi: ERC20_ABI, functionName: "approve", args: [OKU_SWAP_ROUTER, amountIn] });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const decimalsOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: "decimals" }) as number;
  const symbolOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: "symbol" }) as string;

  const swapTx = await walletClient.writeContract({
    address: OKU_SWAP_ROUTER,
    abi: SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{ tokenIn, tokenOut, fee: raw.fee_tier, recipient: account.address, amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: BigInt(0) }],
  });
  await publicClient.waitForTransactionReceipt({ hash: swapTx });

  return {
    tx_hash: swapTx,
    sold: `${formatUnits(amountIn, decimalsIn)} ${symbolIn}`,
    received: `${formatUnits(amountOut, decimalsOut)} ${symbolOut}`,
    slippage_bps: raw.slippage_bps,
    fee_tier: raw.fee_tier,
    explorer: `https://explorer.goat.network/tx/${swapTx}`,
  };
}

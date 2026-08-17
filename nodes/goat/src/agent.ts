import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseAbi,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─── Network config ───────────────────────────────────────────────────────────

const IS_TESTNET = (process.env.GOAT_NETWORK ?? "testnet") === "testnet";

const goatChain: Chain = IS_TESTNET
  ? {
      id: 48816,
      name: "GOAT Network Testnet",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
      blockExplorers: { default: { name: "GoatScan", url: "https://explorer.testnet3.goat.network" } },
    }
  : {
      id: 2345,
      name: "GOAT Network",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: [process.env.GOAT_RPC_URL ?? "https://rpc.goat.network"] } },
      blockExplorers: { default: { name: "GoatScan", url: "https://explorer.goat.network" } },
    };

// ─── Contracts (mainnet only — OKU not on testnet) ────────────────────────────

const OKU_SWAP_ROUTER = "0xaa52bB8110fE38D0d2d2AF0B85C3A3eE622CA455" as Hex;
const OKU_QUOTER     = "0x5911cB3633e764939edc2d92b7e1ad375Bb57649" as Hex;

const KNOWN_TOKENS: Record<string, Hex> = {
  WGBTC:  "0xbC10000000000000000000000000000000000000",
  GOATED: "0xbC10000000000000000000000000000000000001",
  USDCe:  "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
  BTCB:   "0xfe41e7e5cB3460c483AB2A38eb605Cda9e2d248E",
  USDT:   "0xE1AD845D93853fff44990aE0DcecD8575293681e",
  uBTC:   "0x78E26E8b953C7c78A58d69d8B9A91745C2BbB258",
  DOGEB:  "0x1E0d0303a8c4aD428953f5ACB1477dB42bb838cf",
  BILLY:  "0x620b00D5fdaD7dF34779077A736c359F25f1c917",
  NANNY:  "0x0a479Ca22d094B44C5E16738C54870614D4d65b9",
};

const KNOWN_TOKENS_UPPER: Record<string, Hex> = Object.fromEntries(
  Object.entries(KNOWN_TOKENS).map(([k, v]) => [k.toUpperCase(), v])
);

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Gruff, a trading agent on GOAT Network (Bitcoin L2). You are currently on ${IS_TESTNET ? "testnet" : "mainnet"}.

You have your own wallet and can check balances, get swap quotes, and execute swaps via OKU (Uniswap V3 on GOAT).

You can trade ANY token on GOAT Network — not just well-known ones. If the user mentions a token you don't recognise:
- If they give a contract address (0x...), use it directly with lookup_token to get its info
- Use find_pool to discover which fee tier has liquidity for a pair before quoting or swapping
- You can pass contract addresses directly as token_in / token_out in any tool

Known tokens for convenience: WGBTC, USDCe, GOATED, BTCB, USDT, uBTC, DOGEB, BILLY, NANNY.

${IS_TESTNET ? "NOTE: You are on testnet. OKU DEX is not deployed on testnet so swaps are not available. You can only check balances." : ""}

Always check balance before a swap. Always get a quote before executing. Be concise and clear.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  data: Record<string, unknown>;
  message: string;
}

export async function runGruffAgent(message: string): Promise<AgentResult> {
  const collected: Record<string, unknown> = {};

  try {
    const result = await generateText({
      model: openai("gpt-4o"),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
      maxSteps: 10,
      temperature: 0.2,

      tools: {
        get_wallet_balance: tool({
          description: "Get the agent wallet address and native BTC balance.",
          parameters: z.object({}),
          execute: async () => {
            const { account, publicClient } = getClients();
            const raw = await publicClient.getBalance({ address: account.address });
            const data = {
              address: account.address,
              balance: formatUnits(raw, 18),
              symbol: "BTC",
              network: IS_TESTNET ? "testnet" : "mainnet",
            };
            collected.wallet = data;
            return data;
          },
        }),

        get_token_balance: tool({
          description: "Get the balance of a specific ERC-20 token in the agent wallet.",
          parameters: z.object({
            token: z.string().describe("Token symbol e.g. WGBTC, USDCe, GOATED"),
          }),
          execute: async ({ token }) => {
            const { account, publicClient } = getClients();
            const address = resolveAddress(token);
            const [raw, decimals, symbol] = await Promise.all([
              publicClient.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
              publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
              publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
            ]);
            const data = {
              token: symbol as string,
              balance: formatUnits(raw as bigint, decimals as number),
              address,
            };
            collected.token_balance = data;
            return data;
          },
        }),

        lookup_token: tool({
          description: "Look up any ERC-20 token by contract address. Returns symbol, decimals, name, and your wallet balance.",
          parameters: z.object({
            address: z.string().describe("Token contract address e.g. 0x3022b87..."),
          }),
          execute: async ({ address }) => {
            const { account, publicClient } = getClients();
            const addr = address as Hex;
            const NAME_ABI = parseAbi(["function name() view returns (string)"]);
            const [symbol, decimals, name, rawBalance] = await Promise.all([
              publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }),
              publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }),
              publicClient.readContract({ address: addr, abi: NAME_ABI, functionName: "name" }).catch(() => ""),
              publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
            ]);
            return {
              address: addr,
              symbol: symbol as string,
              name: name as string,
              decimals: decimals as number,
              wallet_balance: formatUnits(rawBalance as bigint, decimals as number),
            };
          },
        }),

        find_pool: tool({
          description: "Find which fee tier has an active liquidity pool for a token pair on OKU. Try this before quoting an unknown token.",
          parameters: z.object({
            token_in: z.string().describe("Token address or symbol to sell"),
            token_out: z.string().describe("Token address or symbol to buy"),
          }),
          execute: async ({ token_in, token_out }) => {
            if (IS_TESTNET) return { error: "OKU is not on testnet." };
            const { publicClient } = getClients();
            const tokenIn = resolveAddress(token_in);
            const tokenOut = resolveAddress(token_out);
            const decimalsIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as number;
            const testAmount = parseUnits("0.001", decimalsIn);
            const feeTiers = [100, 500, 3000, 10000];
            const results: { fee_tier: number; has_liquidity: boolean; error?: string }[] = [];
            for (const fee of feeTiers) {
              try {
                await publicClient.readContract({
                  address: OKU_QUOTER,
                  abi: QUOTER_ABI,
                  functionName: "quoteExactInputSingle",
                  args: [{ tokenIn, tokenOut, amountIn: testAmount, fee, sqrtPriceLimitX96: BigInt(0) }],
                });
                results.push({ fee_tier: fee, has_liquidity: true });
              } catch {
                results.push({ fee_tier: fee, has_liquidity: false });
              }
            }
            const best = results.find(r => r.has_liquidity);
            return { results, recommended_fee_tier: best?.fee_tier ?? null };
          },
        }),

        get_swap_quote: tool({
          description: "Get a live price quote for a swap via OKU. Only works on mainnet.",
          parameters: z.object({
            token_in: z.string().describe("Token to sell e.g. WGBTC"),
            token_out: z.string().describe("Token to buy e.g. USDCe"),
            amount_in: z.string().describe("Amount to sell e.g. 0.001"),
            fee_tier: z.number().optional().describe("Pool fee tier: 100, 500, 3000. Default 500"),
          }),
          execute: async ({ token_in, token_out, amount_in, fee_tier = 500 }) => {
            if (IS_TESTNET) return { error: "OKU DEX is not on testnet. Switch to mainnet for quotes." };
            const { publicClient } = getClients();
            const tokenIn = resolveAddress(token_in);
            const tokenOut = resolveAddress(token_out);
            const decimalsIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as number;
            const amountIn = parseUnits(amount_in, decimalsIn);
            const [amountOut] = await publicClient.readContract({
              address: OKU_QUOTER,
              abi: QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [{ tokenIn, tokenOut, amountIn, fee: fee_tier, sqrtPriceLimitX96: BigInt(0) }],
            }) as [bigint, bigint, number, bigint];
            const decimalsOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: "decimals" }) as number;
            const data = {
              sell: `${amount_in} ${token_in.toUpperCase()}`,
              buy: `${formatUnits(amountOut, decimalsOut)} ${token_out.toUpperCase()}`,
              rate: (Number(formatUnits(amountOut, decimalsOut)) / Number(amount_in)).toFixed(6),
              fee_tier,
            };
            collected.quote = data;
            return data;
          },
        }),

        execute_swap: tool({
          description: "Execute a token swap via OKU on GOAT Network. Only works on mainnet.",
          parameters: z.object({
            token_in: z.string().describe("Token to sell e.g. WGBTC"),
            token_out: z.string().describe("Token to buy e.g. USDCe"),
            amount_in: z.string().describe("Exact amount to sell"),
            slippage_bps: z.number().optional().describe("Slippage tolerance in basis points. Default 50 (0.5%)"),
            fee_tier: z.number().optional().describe("Pool fee tier. Default 500"),
          }),
          execute: async ({ token_in, token_out, amount_in, slippage_bps = 50, fee_tier = 500 }) => {
            if (IS_TESTNET) return { error: "OKU DEX is not on testnet. Switch to mainnet to swap." };
            const { account, publicClient, walletClient } = getClients();
            const tokenIn = resolveAddress(token_in);
            const tokenOut = resolveAddress(token_out);
            const decimalsIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as number;
            const amountIn = parseUnits(amount_in, decimalsIn);
            const [amountOut] = await publicClient.readContract({
              address: OKU_QUOTER,
              abi: QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [{ tokenIn, tokenOut, amountIn, fee: fee_tier, sqrtPriceLimitX96: BigInt(0) }],
            }) as [bigint, bigint, number, bigint];
            const amountOutMin = (amountOut * BigInt(10000 - slippage_bps)) / BigInt(10000);
            const allowance = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "allowance", args: [account.address, OKU_SWAP_ROUTER] }) as bigint;
            if (allowance < amountIn) {
              const approveTx = await walletClient.writeContract({ address: tokenIn, abi: ERC20_ABI, functionName: "approve", args: [OKU_SWAP_ROUTER, amountIn] });
              await publicClient.waitForTransactionReceipt({ hash: approveTx });
            }
            const decimalsOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: "decimals" }) as number;
            const swapTx = await walletClient.writeContract({
              address: OKU_SWAP_ROUTER,
              abi: SWAP_ROUTER_ABI,
              functionName: "exactInputSingle",
              args: [{ tokenIn, tokenOut, fee: fee_tier, recipient: account.address, amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: BigInt(0) }],
            });
            await publicClient.waitForTransactionReceipt({ hash: swapTx });
            const data = {
              tx_hash: swapTx,
              sold: `${amount_in} ${token_in.toUpperCase()}`,
              received: `${formatUnits(amountOut, decimalsOut)} ${token_out.toUpperCase()}`,
              explorer: `https://explorer.goat.network/tx/${swapTx}`,
            };
            collected.swap = data;
            return data;
          },
        }),
      },
    });

    return { success: true, data: collected, message: result.text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent failed";
    return { success: false, data: {}, message };
  }
}

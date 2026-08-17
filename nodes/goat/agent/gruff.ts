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
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  IS_TESTNET,
  goatChain,
  OKU_SWAP_ROUTER,
  OKU_QUOTER,
  KNOWN_TOKENS_UPPER,
  ERC20_ABI,
  QUOTER_ABI,
  SWAP_ROUTER_ABI,
} from "../goat.constants";
import type { AgentResult } from "../goat.types";

const SYSTEM_PROMPT = `You are Gruff, a trading agent on GOAT Network (Bitcoin L2). You are currently on ${IS_TESTNET ? "testnet" : "mainnet"}.

You have your own wallet and can check balances, get swap quotes, and execute swaps via OKU (Uniswap V3 on GOAT).

You can trade ANY token on GOAT Network — not just well-known ones. If the user mentions a token you don't recognise:
- If they give a contract address (0x...), use it directly with lookup_token to get its info
- Use find_pool to discover which fee tier has liquidity for a pair before quoting or swapping
- You can pass contract addresses directly as token_in / token_out in any tool

Known tokens for convenience: WGBTC, USDCe, GOATED, BTCB, USDT, uBTC, DOGEB, BILLY, NANNY.

${IS_TESTNET ? "NOTE: You are on testnet. OKU DEX is not deployed on testnet so swaps are not available. You can only check balances." : ""}

Always check balance before a swap. Always get a quote before executing. Be concise and clear.`;

export class GruffAgent {
  private getClients() {
    const privateKey = process.env.GOAT_PRIVATE_KEY;
    if (!privateKey) throw new Error("GOAT_PRIVATE_KEY is not set");
    const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: goatChain, transport: http() });
    const walletClient = createWalletClient({ chain: goatChain, transport: http(), account });
    return { account, publicClient, walletClient };
  }

  private resolveAddress(symbol: string): Hex {
    const upper = symbol.toUpperCase();
    if (KNOWN_TOKENS_UPPER[upper]) return KNOWN_TOKENS_UPPER[upper];
    if (/^0x[0-9a-fA-F]{40}$/.test(symbol)) return symbol as Hex;
    throw new Error(`Unknown token "${symbol}". Known tokens: WGBTC, USDCe, GOATED, BTCB, USDT, uBTC, DOGEB, BILLY, NANNY`);
  }

  async run(message: string): Promise<AgentResult> {
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
              const { account, publicClient } = this.getClients();
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
              const { account, publicClient } = this.getClients();
              const address = this.resolveAddress(token);
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
              const { account, publicClient } = this.getClients();
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
              const { publicClient } = this.getClients();
              const tokenIn = this.resolveAddress(token_in);
              const tokenOut = this.resolveAddress(token_out);
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
              const { publicClient } = this.getClients();
              const tokenIn = this.resolveAddress(token_in);
              const tokenOut = this.resolveAddress(token_out);
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
              const { account, publicClient, walletClient } = this.getClients();
              const tokenIn = this.resolveAddress(token_in);
              const tokenOut = this.resolveAddress(token_out);
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
}

export const gruff = new GruffAgent();

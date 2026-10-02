import { generateText, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { JsonRpcProvider, Wallet } from "ethers";
import { ViemWalletProvider } from "@goatnetwork/agentkit/core";
import { ActionProvider } from "@goatnetwork/agentkit/providers";
import { PolicyEngine, ExecutionRuntime } from "@goatnetwork/agentkit/core";
import {
  dexSwapAction,
  dexQuoteAction,
  approveErc20Action,
} from "@goatnetwork/agentkit/plugins";
import { walletBalanceAction } from "@goatnetwork/agentkit/plugins";
import { EvmWalletReadAdapter } from "@goatnetwork/agentkit/plugins";
import {
  IS_TESTNET,
  goatChain,
  KNOWN_TOKENS_UPPER,
  ERC20_ABI,
} from "../gruff.constants";
import type { AgentResult } from "../gruff.types";

function buildSystemPrompt(walletAddress: string): string {
  return `You are Gruff, a trading agent on GOAT Network (Bitcoin L2). You are on ${IS_TESTNET ? "testnet" : "mainnet"}.

YOUR WALLET ADDRESS: ${walletAddress}
Always use this exact address as the "address" field in wallet.balance calls. Never use a token name or symbol as the address.

Token addresses:
- WGBTC:  0xbC10000000000000000000000000000000000000
- USDCe:  0x3022b87ac063DE95b1570F46f5e470F8B53112D8
- GOATED: 0xbC10000000000000000000000000000000000001
- DOGEB:  0x1E0d0303a8c4aD428953f5ACB1477dB42bb838cf
- BTCB:   0xfe41e7e5cB3460c483AB2A38eb605Cda9e2d248E
- USDT:   0xE1AD845D93853fff44990aE0DcecD8575293681e

Active pools on OKU GOAT. Gruff's base currency is USDCe. Only swap when you have the tokenIn in your wallet:
- USDCe → WGBTC:  fee=500  (buyable with USDCe)
- USDCe → GOATED: fee=100  (buyable with USDCe)
- USDCe → DOGEB:  fee=3000 (buyable with USDCe)
- WGBTC → BTCB:   fee=500  (needs WGBTC, NOT USDCe — skip if you only hold USDCe)

If the token_address is not WGBTC, GOATED, or DOGEB — skip, you cannot buy it with USDCe.

To check a token balance: wallet.balance({ address: "${walletAddress}", tokenAddress: "<token_address>" })
To check native BTC: wallet.balance({ address: "${walletAddress}" })

${IS_TESTNET ? "NOTE: On testnet. OKU DEX swaps are not available — balance checks only." : ""}

WORKFLOW INPUT RULES — when you receive structured input from the workflow:
- If the input contains "passed": true — the security scan is already done and approved. Do NOT run or wait for any scan. Proceed immediately to execute the trade.
- If the input contains "passed": false — skip the trade, explain why.
- The "token_address" field is the token the workflow wants to buy using USDCe. Map it: if token_address == WGBTC address, buy WGBTC. If it is anything other than WGBTC (0xbC10000000000000000000000000000000000000), skip — you cannot trade it on OKU.
- Ignore the "if security scan passes" text in the message field — the "passed" field is the definitive answer.
- "Spend no more than $X" — convert X USD to USDCe base units (6 decimals) and use that as amountIn, capped to your actual balance.

Always check balance before a swap. Always quote before executing. Be concise.

After a successful swap, always include the transaction link in your response: https://explorer.goat.network/tx/<txHash>`;
}

function getPrivateKey(): Hex {
  const pk = process.env.GOAT_PRIVATE_KEY;
  if (!pk) throw new Error("GOAT_PRIVATE_KEY is not set");
  return (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
}

function resolveAddress(symbol: string): Hex {
  const upper = symbol.toUpperCase();
  if (KNOWN_TOKENS_UPPER[upper]) return KNOWN_TOKENS_UPPER[upper];
  if (/^0x[0-9a-fA-F]{40}$/.test(symbol)) return symbol as Hex;
  throw new Error(`Unknown token "${symbol}". Known: WGBTC, USDCe, GOATED, BTCB, USDT, uBTC, DOGEB, BILLY, NANNY`);
}

function buildAgentKit() {
  const key = getPrivateKey();
  const account = privateKeyToAccount(key);
  const rpcUrl = process.env.GOAT_RPC_URL ?? (IS_TESTNET ? "https://rpc.testnet3.goat.network" : "https://rpc.goat.network");

  // Viem clients for ViemWalletProvider
  const walletClient = createWalletClient({ account, chain: goatChain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: goatChain, transport: http(rpcUrl) });
  const wallet = new ViemWalletProvider(account, goatChain, http(rpcUrl), IS_TESTNET ? "goat-testnet" : "goat-mainnet");

  // Ethers provider for EvmWalletReadAdapter
  const ethersProvider = new JsonRpcProvider(rpcUrl);
  const readAdapter = new EvmWalletReadAdapter(ethersProvider);

  const provider = new ActionProvider();
  provider.register(walletBalanceAction(readAdapter));
  provider.register(dexQuoteAction(wallet));
  if (!IS_TESTNET) {
    provider.register(approveErc20Action(wallet));
    provider.register(dexSwapAction(wallet));
  }

  const policy = new PolicyEngine({
    allowedNetworks: [IS_TESTNET ? "goat-testnet" : "goat-mainnet"],
    maxRiskWithoutConfirm: "high",
    writeEnabled: !IS_TESTNET,
  });

  const runtime = new ExecutionRuntime(policy, { maxRetries: 1, retryDelayMs: 500 });

  return { provider, runtime, wallet, publicClient, walletClient, account, walletAddress: account.address };
}

// Resolve token symbol fields to addresses before passing to DEX actions.
// Handles tokenIn, tokenOut, tokenAddress — anything that looks like a symbol.

function resolveTokenFields(input: Record<string, unknown>): Record<string, unknown> {
  const TOKEN_FIELDS = ["tokenIn", "tokenOut", "tokenAddress"];
  const out: Record<string, unknown> = { ...input };
  for (const field of TOKEN_FIELDS) {
    const val = out[field];
    if (typeof val === "string" && !val.startsWith("0x")) {
      try {
        out[field] = resolveAddress(val);
      } catch {
        // leave as-is if not a known symbol
      }
    }
  }
  return out;
}

export class GruffAgent {
  async run(message: string, context: Record<string, unknown> = {}): Promise<AgentResult> {
    const collected: Record<string, unknown> = {};

    try {
      const { provider, runtime, walletAddress, publicClient } = buildAgentKit();
      const network = IS_TESTNET ? "goat-testnet" : "goat-mainnet";
      const OKU_ROUTER = "0xaa52bB8110fE38D0d2d2AF0B85C3A3eE622CA455";
      const allTools = provider.vercelAITools(network);
      // Hide wallet.approve_erc20 from the LLM — approve is handled automatically inside dex.swap
      const toolManifest = allTools.filter((t) => t.name !== "wallet.approve_erc20");
      // OpenAI requires tool names matching ^[a-zA-Z0-9_-]+$ — sanitize dots → underscores
      const sanitizeName = (n: string) => n.replace(/[^a-zA-Z0-9_-]/g, "_");
      // Map sanitized name → original name so we can call provider.get()
      const nameMap = new Map(toolManifest.map((t) => [sanitizeName(t.name), t.name]));

      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const result = await generateText({
        model: openai("gpt-4o"),
        system: buildSystemPrompt(walletAddress),
        messages: [{ role: "user", content: Object.keys(context).length > 0
          ? `${message}\n\nWorkflow context:\n${JSON.stringify(context, null, 2)}`
          : message,
        }],
        maxSteps: 10,
        temperature: 0.2,
        tools: Object.fromEntries(
          toolManifest.map((t) => {
            const safeName = sanitizeName(t.name);
            return [
              safeName,
              {
                description: t.description,
                parameters: jsonSchema(t.parameters ?? { type: "object", properties: {} }),
                execute: async (input: unknown) => {
                  const originalName = nameMap.get(safeName) ?? t.name;
                  const resolved = resolveTokenFields(input as Record<string, unknown>);
                  const ctx = { traceId: crypto.randomUUID(), network, now: Date.now() };

                  // wallet.balance can throw BAD_DATA if tokenAddress isn't a real ERC20 — return zero gracefully
                  if (originalName === "wallet.balance" && resolved.tokenAddress) {
                    try {
                      const raw = await publicClient.readContract({
                        address: resolved.tokenAddress as Hex, abi: ERC20_ABI, functionName: "balanceOf", args: [walletAddress],
                      }) as bigint;
                      return { address: walletAddress, tokenAddress: resolved.tokenAddress, balance: raw.toString() };
                    } catch {
                      return { address: walletAddress, tokenAddress: resolved.tokenAddress, balance: "0", error: "token_not_found" };
                    }
                  }

                  // For swaps, cap amountIn to wallet balance then approve before swap
                  if (originalName === "dex.swap") {
                    const tokenIn = resolved.tokenIn as Hex;
                    const rawBalance = await publicClient.readContract({
                      address: tokenIn, abi: ERC20_ABI, functionName: "balanceOf", args: [walletAddress],
                    }) as bigint;
                    const requestedAmount = BigInt(resolved.amountIn as string);
                    if (rawBalance === 0n) throw new Error("Insufficient balance: wallet has no tokenIn balance");
                    const safeAmountIn = requestedAmount > rawBalance ? rawBalance : requestedAmount;
                    (resolved as Record<string, unknown>).amountIn = safeAmountIn.toString();

                    const approveAction = provider.get("wallet.approve_erc20");
                    const approveRes = await runtime.run(approveAction, ctx, {
                      tokenAddress: tokenIn,
                      spender: OKU_ROUTER,
                      amount: safeAmountIn.toString(),
                    }, { confirmed: true });
                    if (!approveRes.ok) throw new Error(`Approve failed: ${approveRes.error}`);
                  }

                  const action = provider.get(originalName);
                  const res = await runtime.run(action, ctx, resolved, { confirmed: true });
                  // Quote revert = no pool for this pair — return null so LLM can decide to skip
                  if (!res.ok && originalName === "dex.quote") {
                    return { amountOut: "0", error: "no_pool", message: `No liquidity pool found for this pair` };
                  }
                  if (res.ok) {
                    let output = res.output as Record<string, unknown>;
                    // Attach explorer link for swap results
                    if (originalName === "dex.swap" && output?.txHash) {
                      output = { ...output, explorer: `https://explorer.goat.network/tx/${output.txHash}` };
                    }
                    collected[originalName] = output;
                    return output;
                  }
                  throw new Error(res.error ?? "Action failed");
                },
              },
            ];
          })
        ),
      });

      // Flatten swap result to top-level so downstream nodes (e.g. Telegram) can access tx_hash directly
      const swapResult = collected["dex.swap"] as Record<string, unknown> | undefined;
      const flatData: Record<string, unknown> = {
        ...collected,
        agent_message: result.text,
        ...(swapResult?.txHash ? {
          tx_hash: swapResult.txHash,
          explorer: swapResult.explorer ?? `https://explorer.goat.network/tx/${swapResult.txHash}`,
          action: "SWAP",
        } : {
          action: "SKIP",
        }),
      };
      return { success: true, data: flatData, message: result.text };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Agent failed";
      return { success: false, data: { agent_message: errMsg, action: "ERROR" }, message: errMsg };
    }
  }

  async getPortfolio(extraTokens: string[] = []): Promise<AgentResult> {
    try {
      const { provider, runtime, account, publicClient } = buildAgentKit();
      const network = IS_TESTNET ? "goat-testnet" : "goat-mainnet";
      const address = account.address;

      // Native balance
      const nativeAction = provider.get("wallet.balance");
      const ctx = { traceId: crypto.randomUUID(), network, now: Date.now() };
      const nativeRes = await runtime.run(nativeAction, ctx, { address });
      const native = nativeRes.ok ? nativeRes.output : null;

      // Known ERC20 balances
      const tokenAddresses = [
        ...Object.values(KNOWN_TOKENS_UPPER),
        ...extraTokens.map((t) => resolveAddress(t)),
      ];

      const tokenBalances = await Promise.all(
        tokenAddresses.map(async (tokenAddress) => {
          try {
            const [raw, decimals, symbol] = await Promise.all([
              publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
              publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
              publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "symbol" }),
            ]);
            return { address: tokenAddress, symbol: symbol as string, balance: formatUnits(raw as bigint, decimals as number) };
          } catch {
            return null;
          }
        })
      );

      const tokens = tokenBalances.filter(Boolean);
      const tokensWithBalance = tokens.filter((t) => t && parseFloat(t.balance) > 0);

      const data = {
        wallet_address: address,
        native_balance: native,
        tokens,
        tokens_with_balance: tokensWithBalance,
      };

      return { success: true, data, message: "Portfolio fetched" };
    } catch (err) {
      return { success: false, data: {}, message: err instanceof Error ? err.message : "Failed" };
    }
  }

  async sellPosition(token: string, toToken: string, amount?: string, slippageBps = 50, feeTier = 500): Promise<AgentResult> {
    if (IS_TESTNET) return { success: false, data: {}, message: "Swaps not available on testnet" };
    try {
      const { provider, runtime, account, publicClient } = buildAgentKit();
      const network = "goat-mainnet";
      const ctx = { traceId: crypto.randomUUID(), network, now: Date.now() };

      const tokenIn = resolveAddress(token);
      const tokenOut = resolveAddress(toToken);

      const [rawBalance, decimalsIn] = await Promise.all([
        publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
        publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
      ]);

      const amountIn = amount ? parseUnits(amount, decimalsIn) : rawBalance;

      // Quote
      const quoteAction = provider.get("dex.quote");
      const quoteRes = await runtime.run(quoteAction, ctx, {
        tokenIn, tokenOut, fee: feeTier, amountIn: amountIn.toString(),
      });
      if (!quoteRes.ok) throw new Error(quoteRes.error ?? "Quote failed");
      const amountOut = BigInt((quoteRes.output as { amountOut: string }).amountOut);
      const amountOutMin = (amountOut * BigInt(10000 - slippageBps)) / BigInt(10000);

      // Approve
      const approveAction = provider.get("wallet.approve_erc20");
      await runtime.run(approveAction, ctx, {
        tokenAddress: tokenIn, spender: "0xaa52bB8110fE38D0d2d2AF0B85C3A3eE622CA455", amount: amountIn.toString(),
      }, { confirmed: true });

      // Swap
      const swapAction = provider.get("dex.swap");
      const swapRes = await runtime.run(swapAction, ctx, {
        tokenIn, tokenOut, fee: feeTier, amountIn: amountIn.toString(), amountOutMinimum: amountOutMin.toString(),
      }, { confirmed: true });
      if (!swapRes.ok) throw new Error(swapRes.error ?? "Swap failed");

      const { txHash } = swapRes.output as { txHash: string };
      const decimalsOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: "decimals" }) as number;

      return {
        success: true,
        data: {
          tx_hash: txHash,
          sold: `${amount ?? formatUnits(rawBalance, decimalsIn)} ${token.toUpperCase()}`,
          received: `${formatUnits(amountOut, decimalsOut)} ${toToken.toUpperCase()}`,
          explorer: `https://explorer.goat.network/tx/${txHash}`,
        },
        message: "Position sold",
      };
    } catch (err) {
      return { success: false, data: {}, message: err instanceof Error ? err.message : "Failed" };
    }
  }
}

export const gruff = new GruffAgent();

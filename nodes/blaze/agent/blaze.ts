import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  Keypair,
  Horizon,
  Asset,
  TransactionBuilder,
  Operation,
} from "@stellar/stellar-sdk";
import {
  SoroswapSDK,
  TradeType,
} from "@soroswap/sdk";
import {
  IS_TESTNET,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  SOROSWAP_NETWORK,
  SOROSWAP_TOKENS,
  USDC_ISSUER,
  TX_FEE,
  SupportedProtocols,
} from "../blaze.constants";
import type { AgentResult } from "../blaze.types";

const horizon = new Horizon.Server(HORIZON_URL);

const AGENT_ADDRESS = process.env.STELLAR_AGENT_PUBLIC_KEY ?? "not configured";

const SYSTEM_PROMPT = `You are Blaze, a Stellar blockchain trading agent with your own wallet on Stellar ${IS_TESTNET ? "testnet" : "mainnet"}.

Agent wallet: ${AGENT_ADDRESS}
Default pair: XLM / USDC
DEX: Soroswap (when API key is set) or Stellar SDEX path payments (fallback)

Rules:
- Always check the wallet balance before a trade
- Always get a quote before executing a swap
- Apply at least 1% slippage when computing min_receive from a quote
- If a tool fails, explain what went wrong clearly
- Be concise — show numbers, hashes, and balances directly
- For funding: only use Friendbot on testnet`;

export class StellarAgent {
  private getKeypair(): Keypair {
    const secret = process.env.STELLAR_AGENT_SECRET_KEY;
    if (!secret) throw new Error("STELLAR_AGENT_SECRET_KEY is not set");
    return Keypair.fromSecret(secret);
  }

  private getSoroswap(): SoroswapSDK | null {
    const apiKey = process.env.SOROSWAP_API_KEY;
    if (!apiKey) return null;
    return new SoroswapSDK({ apiKey, defaultNetwork: SOROSWAP_NETWORK });
  }

  private resolveClassicAsset(code: string, issuer?: string): Asset {
    if (code.toUpperCase() === "XLM") return Asset.native();
    return new Asset(code.toUpperCase(), issuer ?? USDC_ISSUER);
  }

  private resolveSoroswapContract(code: string): string | null {
    return SOROSWAP_TOKENS[code.toUpperCase()] ?? null;
  }

  private toStroops(amount: string): bigint {
    const [whole, frac = ""] = amount.split(".");
    const padded = frac.padEnd(7, "0").slice(0, 7);
    return BigInt(whole) * BigInt(10_000_000) + BigInt(padded);
  }

  async run(message: string): Promise<AgentResult> {
    const collected: Record<string, unknown> = {};

    try {
      const result = await generateText({
        model: openai("gpt-4o"),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: message }],
        maxSteps: 8,
        temperature: 0.2,

        tools: {
          get_wallet_balance: tool({
            description: "Get the agent wallet address and current balances of all held assets.",
            parameters: z.object({}),
            execute: async () => {
              const kp = this.getKeypair();
              try {
                const account = await horizon.loadAccount(kp.publicKey());
                const balances = account.balances
                  .filter((b) => b.asset_type !== "liquidity_pool_shares")
                  .map((b) =>
                    b.asset_type === "native"
                      ? { asset: "XLM", balance: b.balance }
                      : { asset: (b as Horizon.HorizonApi.BalanceLineAsset).asset_code, issuer: (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer, balance: b.balance }
                  );
                const data = { publicKey: kp.publicKey(), balances, network: IS_TESTNET ? "testnet" : "mainnet" };
                collected.wallet = data;
                return data;
              } catch {
                return { publicKey: kp.publicKey(), balances: [], note: "Account not yet funded — use fund_testnet to get XLM" };
              }
            },
          }),

          fund_testnet: tool({
            description: "Fund the agent wallet with 10,000 testnet XLM using Friendbot. Only works on testnet.",
            parameters: z.object({}),
            execute: async () => {
              if (!IS_TESTNET) return { ok: false, message: "Friendbot is only available on testnet" };
              const kp = this.getKeypair();
              try {
                await horizon.friendbot(kp.publicKey()).call();
                const data = { ok: true, funded: kp.publicKey(), amount: "10000 XLM" };
                collected.fund = data;
                return data;
              } catch {
                return { ok: false, message: "Already funded or Friendbot is unavailable" };
              }
            },
          }),

          add_trustline: tool({
            description: "Add a trustline so the wallet can hold a non-XLM asset. Required before receiving USDC.",
            parameters: z.object({
              asset_code: z.string().describe("Asset code e.g. USDC"),
              issuer: z.string().optional().describe("Issuer address — leave blank for USDC"),
            }),
            execute: async ({ asset_code, issuer }) => {
              const kp = this.getKeypair();
              const asset = this.resolveClassicAsset(asset_code, issuer);
              const account = await horizon.loadAccount(kp.publicKey());
              const tx = new TransactionBuilder(account, {
                fee: TX_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(Operation.changeTrust({ asset }))
                .setTimeout(30)
                .build();
              tx.sign(kp);
              const submitted = await horizon.submitTransaction(tx);
              const data = { tx_hash: submitted.hash, asset: asset_code, issuer: issuer ?? USDC_ISSUER };
              collected.trustline = data;
              return data;
            },
          }),

          get_swap_quote: tool({
            description: "Get the best available swap route and estimated output. Uses Soroswap if API key is configured, otherwise Stellar path payments. Always call this before execute_swap.",
            parameters: z.object({
              from_asset: z.string().describe("Asset to send e.g. XLM"),
              from_amount: z.string().describe("Amount to send e.g. 100"),
              to_asset: z.string().describe("Asset to receive e.g. USDC"),
              to_issuer: z.string().optional().describe("Issuer for non-standard assets"),
            }),
            execute: async ({ from_asset, from_amount, to_asset, to_issuer }) => {
              const soroswap = this.getSoroswap();

              if (soroswap) {
                const fromContract = this.resolveSoroswapContract(from_asset);
                const toContract = this.resolveSoroswapContract(to_asset);

                if (fromContract && toContract) {
                  const quote = await soroswap.quote({
                    assetIn: fromContract,
                    assetOut: toContract,
                    amount: this.toStroops(from_amount),
                    tradeType: TradeType.EXACT_IN,
                    protocols: [SupportedProtocols.SOROSWAP, SupportedProtocols.AQUA, SupportedProtocols.SDEX],
                    slippageBps: 100,
                  });
                  const data = {
                    via: "soroswap",
                    from: `${from_amount} ${from_asset.toUpperCase()}`,
                    to: to_asset.toUpperCase(),
                    estimated_out: quote,
                    slippage_bps: 100,
                    _quote: quote,
                  };
                  collected.quote = data;
                  return data;
                }
              }

              // Fallback: Stellar SDEX path payments
              const src = this.resolveClassicAsset(from_asset);
              const dst = this.resolveClassicAsset(to_asset, to_issuer);
              const paths = await horizon.strictSendPaths(src, from_amount, [dst]).call();
              const routes = paths.records.slice(0, 3).map((r) => ({
                send: `${r.source_amount} ${from_asset.toUpperCase()}`,
                receive: `${r.destination_amount} ${to_asset.toUpperCase()}`,
                rate: (parseFloat(r.destination_amount) / parseFloat(r.source_amount)).toFixed(6),
              }));
              const data = { via: "sdex", routes, best: routes[0] };
              collected.quote = data;
              return data;
            },
          }),

          get_order_book: tool({
            description: "Read the live Stellar SDEX order book for a trading pair. Shows top 5 bids and asks.",
            parameters: z.object({
              base: z.string().describe("Base asset e.g. XLM"),
              counter: z.string().describe("Counter asset e.g. USDC"),
              counter_issuer: z.string().optional(),
            }),
            execute: async ({ base, counter, counter_issuer }) => {
              const baseAsset = this.resolveClassicAsset(base);
              const counterAsset = this.resolveClassicAsset(counter, counter_issuer);
              const ob = await horizon.orderbook(baseAsset, counterAsset).call();
              const data = {
                pair: `${base.toUpperCase()}/${counter.toUpperCase()}`,
                bids: ob.bids.slice(0, 5).map((b) => ({ price: b.price, amount: b.amount })),
                asks: ob.asks.slice(0, 5).map((a) => ({ price: a.price, amount: a.amount })),
              };
              collected.order_book = data;
              return data;
            },
          }),

          execute_swap: tool({
            description: "Execute a swap. Uses Soroswap if API key is set (pass the quote object from get_swap_quote). Falls back to Stellar SDEX path payment. Always get a quote first.",
            parameters: z.object({
              from_asset: z.string().describe("Asset to send e.g. XLM"),
              send_amount: z.string().describe("Exact amount to send"),
              to_asset: z.string().describe("Asset to receive e.g. USDC"),
              to_issuer: z.string().optional(),
              min_receive: z.string().describe("Minimum to receive — apply 1% slippage to the quoted amount"),
              soroswap_quote: z.unknown().optional().describe("Quote object returned by get_swap_quote when via is soroswap"),
            }),
            execute: async ({ from_asset, send_amount, to_asset, to_issuer, min_receive, soroswap_quote }) => {
              const kp = this.getKeypair();
              const soroswap = this.getSoroswap();

              // Try Soroswap path
              if (soroswap && soroswap_quote) {
                try {
                  const built = await soroswap.build({
                    quote: soroswap_quote as Parameters<typeof soroswap.build>[0]["quote"],
                    from: kp.publicKey(),
                    to: kp.publicKey(),
                  });
                  const { Transaction: StellarTx } = await import("@stellar/stellar-sdk");
                  const tx = new StellarTx(built.xdr, NETWORK_PASSPHRASE);
                  tx.sign(kp);
                  const submitted = await soroswap.send(tx.toXDR());
                  const data = {
                    via: "soroswap",
                    tx_hash: (submitted as { hash?: string }).hash,
                    sent: `${send_amount} ${from_asset.toUpperCase()}`,
                    min_received: `${min_receive} ${to_asset.toUpperCase()}`,
                  };
                  collected.swap = data;
                  return data;
                } catch (e) {
                  console.error("[blaze] Soroswap swap failed, falling back to SDEX:", e);
                }
              }

              // SDEX path payment fallback
              const src = this.resolveClassicAsset(from_asset);
              const dst = this.resolveClassicAsset(to_asset, to_issuer);
              const account = await horizon.loadAccount(kp.publicKey());
              const tx = new TransactionBuilder(account, {
                fee: TX_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(
                  Operation.pathPaymentStrictSend({
                    sendAsset: src,
                    sendAmount: send_amount,
                    destination: kp.publicKey(),
                    destAsset: dst,
                    destMin: min_receive,
                    path: [],
                  })
                )
                .setTimeout(30)
                .build();
              tx.sign(kp);
              const submitted = await horizon.submitTransaction(tx);
              const data = {
                via: "sdex",
                tx_hash: submitted.hash,
                sent: `${send_amount} ${from_asset.toUpperCase()}`,
                min_received: `${min_receive} ${to_asset.toUpperCase()}`,
              };
              collected.swap = data;
              return data;
            },
          }),

          place_limit_sell: tool({
            description: "Place a limit sell order on the Stellar SDEX. Stays open until filled or cancelled.",
            parameters: z.object({
              selling: z.string().describe("Asset to sell e.g. XLM"),
              buying: z.string().describe("Asset to receive e.g. USDC"),
              buying_issuer: z.string().optional(),
              amount: z.string().describe("Amount to sell"),
              price: z.string().describe("Price per unit of the selling asset in terms of the buying asset"),
            }),
            execute: async ({ selling, buying, buying_issuer, amount, price }) => {
              const kp = this.getKeypair();
              const sellingAsset = this.resolveClassicAsset(selling);
              const buyingAsset = this.resolveClassicAsset(buying, buying_issuer);
              const account = await horizon.loadAccount(kp.publicKey());
              const tx = new TransactionBuilder(account, {
                fee: TX_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(
                  Operation.manageSellOffer({ selling: sellingAsset, buying: buyingAsset, amount, price, offerId: "0" })
                )
                .setTimeout(30)
                .build();
              tx.sign(kp);
              const submitted = await horizon.submitTransaction(tx);
              const data = {
                tx_hash: submitted.hash,
                type: "limit_sell",
                order: `Sell ${amount} ${selling.toUpperCase()} @ ${price} ${buying.toUpperCase()}`,
              };
              collected.offer = data;
              return data;
            },
          }),

          place_limit_buy: tool({
            description: "Place a limit buy order on the Stellar SDEX.",
            parameters: z.object({
              buying: z.string().describe("Asset to buy e.g. USDC"),
              buying_issuer: z.string().optional(),
              selling: z.string().describe("Asset to pay with e.g. XLM"),
              buy_amount: z.string().describe("Amount to buy"),
              price: z.string().describe("Price per unit"),
            }),
            execute: async ({ buying, buying_issuer, selling, buy_amount, price }) => {
              const kp = this.getKeypair();
              const buyingAsset = this.resolveClassicAsset(buying, buying_issuer);
              const sellingAsset = this.resolveClassicAsset(selling);
              const account = await horizon.loadAccount(kp.publicKey());
              const tx = new TransactionBuilder(account, {
                fee: TX_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(
                  Operation.manageBuyOffer({ selling: sellingAsset, buying: buyingAsset, buyAmount: buy_amount, price, offerId: "0" })
                )
                .setTimeout(30)
                .build();
              tx.sign(kp);
              const submitted = await horizon.submitTransaction(tx);
              const data = {
                tx_hash: submitted.hash,
                type: "limit_buy",
                order: `Buy ${buy_amount} ${buying.toUpperCase()} @ ${price} ${selling.toUpperCase()}`,
              };
              collected.offer = data;
              return data;
            },
          }),

          get_open_offers: tool({
            description: "List all open limit orders the agent has on the SDEX.",
            parameters: z.object({}),
            execute: async () => {
              const kp = this.getKeypair();
              const offers = await horizon.offers().forAccount(kp.publicKey()).call();
              const data = {
                offers: offers.records.map((o) => ({
                  id: o.id,
                  selling: o.selling.asset_type === "native" ? "XLM" : o.selling.asset_code,
                  buying: o.buying.asset_type === "native" ? "XLM" : o.buying.asset_code,
                  amount: o.amount,
                  price: o.price,
                })),
              };
              collected.offers = data;
              return data;
            },
          }),

          cancel_offer: tool({
            description: "Cancel an open limit order by its offer ID.",
            parameters: z.object({
              offer_id: z.string(),
              selling: z.string().describe("Asset that was being sold in the offer"),
              buying: z.string().describe("Asset that was being bought in the offer"),
              buying_issuer: z.string().optional(),
              price: z.string().describe("Original price of the offer"),
            }),
            execute: async ({ offer_id, selling, buying, buying_issuer, price }) => {
              const kp = this.getKeypair();
              const sellingAsset = this.resolveClassicAsset(selling);
              const buyingAsset = this.resolveClassicAsset(buying, buying_issuer);
              const account = await horizon.loadAccount(kp.publicKey());
              const tx = new TransactionBuilder(account, {
                fee: TX_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(
                  Operation.manageSellOffer({ selling: sellingAsset, buying: buyingAsset, amount: "0", price, offerId: offer_id })
                )
                .setTimeout(30)
                .build();
              tx.sign(kp);
              const submitted = await horizon.submitTransaction(tx);
              const data = { tx_hash: submitted.hash, cancelled_offer_id: offer_id };
              collected.cancel = data;
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

export const blaze = new StellarAgent();

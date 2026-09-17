import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { goatChain } from "./gruff.constants";

const USDC_E_ADDRESS = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8" as Hex;
const USDC_E_DECIMALS = 6;
const MERCHANT_WALLET = (process.env.GOAT_WALLET_ADDRESS ?? "0x6B844ac411B68D6C6fB9A9B1efdd816777317928") as Hex;

const account = privateKeyToAccount(`0x${process.env.GOAT_PRIVATE_KEY!}`);

const publicClient = createPublicClient({
  chain: goatChain,
  transport: http(goatChain.rpcUrls.default.http[0]),
});

const walletClient = createWalletClient({
  account,
  chain: goatChain,
  transport: http(goatChain.rpcUrls.default.http[0]),
});

const TOKEN_ABI = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// Action → price in USD
export const ACTION_PRICES: Record<string, number> = {
  execute_trade: 0.001,
  sell_position: 0.001,
};

export interface PermitSignature {
  owner: string;
  spender: string;
  value: string;
  deadline: number;
  nonce: number;
  v: number;
  r: string;
  s: string;
}

// Session tracking: "owner:runId" → calls settled
const sessions = new Map<string, number>();

/**
 * Settle a payment using an EIP-2612 permit signature.
 * Gruff calls permit() to set allowance, then transferFrom() to pull funds.
 * Gruff pays gas — the user only signed a message.
 */
export async function settlePayment(
  permit: PermitSignature,
  runId: string,
  callIndex: number,
  actionPriceUsd: number,
): Promise<{ success: boolean; reason?: string }> {
  const sessionKey = `${permit.owner.toLowerCase()}:${runId}`;
  const settled = sessions.get(sessionKey) ?? 0;

  if (settled > callIndex) {
    return { success: false, reason: "Payment already settled for this call" };
  }

  if (Date.now() / 1000 > permit.deadline) {
    return { success: false, reason: "Payment authorization expired" };
  }

  const priceInUnits = parseUnits(actionPriceUsd.toFixed(6), USDC_E_DECIMALS);

  try {
    // On first call for this session, submit the permit to set allowance and wait for confirmation
    if (settled === 0) {
      const permitHash = await walletClient.writeContract({
        account,
        address: USDC_E_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "permit",
        args: [
          permit.owner as Hex,
          permit.spender as Hex,
          BigInt(permit.value),
          BigInt(permit.deadline),
          permit.v,
          permit.r as Hex,
          permit.s as Hex,
        ],
      });
      const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash });
      if (permitReceipt.status !== "success") {
        return { success: false, reason: "permit() transaction failed on-chain" };
      }
    }

    // Pull exactly the price for this call from user → Gruff
    const transferHash = await walletClient.writeContract({
      account,
      address: USDC_E_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "transferFrom",
      args: [permit.owner as Hex, MERCHANT_WALLET, priceInUnits],
    });
    const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
    if (transferReceipt.status !== "success") {
      return { success: false, reason: "transferFrom() transaction failed on-chain" };
    }

    sessions.set(sessionKey, callIndex + 1);
    return { success: true };
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : "Settlement failed" };
  }
}

export function getMerchantWallet(): Hex {
  return MERCHANT_WALLET;
}

export function getTokenAddress(): Hex {
  return USDC_E_ADDRESS;
}

export function getPaymentRequirement(actionKey: string): {
  priceUsd: number;
  token: Hex;
  payTo: Hex;
  network: string;
} | null {
  const price = ACTION_PRICES[actionKey];
  if (price === undefined) return null;
  return {
    priceUsd: price,
    token: USDC_E_ADDRESS,
    payTo: MERCHANT_WALLET,
    network: `eip155:${goatChain.id}`,
  };
}

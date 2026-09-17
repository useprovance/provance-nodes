import { Router, type Request, type Response } from "express";
import { parseUnits } from "viem";
import { runGruff } from "./gruff.controller";
import {
  getPaymentRequirement,
  settlePayment,
  getMerchantWallet,
  getTokenAddress,
  type PermitSignature,
} from "./x402.store";

const router = Router();

// ── Main action endpoint ──────────────────────────────────────────────────────
router.post("/run", async (req: Request, res: Response) => {
  const { action } = (req.body ?? {}) as { action?: string };
  const paymentReq = action ? getPaymentRequirement(action) : null;

  if (paymentReq) {
    const paymentHeader = req.headers["x-payment"] as string | undefined;
    const runId = (req.headers["x-payment-run-id"] as string | undefined) ?? "default";
    const callIndex = parseInt((req.headers["x-payment-index"] as string | undefined) ?? "0", 10);

    if (!paymentHeader) {
      res.status(402).json({
        x402Version: 1,
        accepts: [{
          scheme: "exact",
          network: paymentReq.network,
          maxAmountRequired: parseUnits(paymentReq.priceUsd.toFixed(6), 6).toString(),
          resource: `${req.protocol}://${req.get("host")}${req.path}`,
          description: `Payment for ${action}`,
          mimeType: "application/json",
          payTo: getMerchantWallet(),
          maxTimeoutSeconds: 600,
          asset: getTokenAddress(),
          extra: { name: "USDCe", version: "1", scheme: "eip2612-permit" },
        }],
        error: "Payment required — sign an EIP-2612 permit and include it in X-PAYMENT (base64 JSON)",
      });
      return;
    }

    let permit: PermitSignature;
    try {
      permit = JSON.parse(Buffer.from(paymentHeader, "base64").toString()) as PermitSignature;
    } catch {
      res.status(400).json({ error: "Invalid X-PAYMENT header — expected base64 JSON permit" });
      return;
    }

    const result = await settlePayment(permit, runId, callIndex, paymentReq.priceUsd);
    if (!result.success) {
      res.status(402).json({
        x402Version: 1,
        accepts: [],
        error: result.reason ?? "Payment settlement failed",
      });
      return;
    }
  }

  return runGruff(req, res);
});

// ── Health ────────────────────────────────────────────────────────────────────
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "gruff", actions: ["execute_trade", "get_portfolio", "sell_position"] },
    message: "Gruff is running",
  });
});

export default router;

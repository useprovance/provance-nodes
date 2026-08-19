import { z } from "zod";

export const MessageSchema = z.object({
  message: z.string().min(1, "message is required"),
});

export type MessageInput = z.infer<typeof MessageSchema>;

export const GetPortfolioSchema = z.object({
  extra_tokens: z.array(z.string()).optional().describe("Extra token addresses to include beyond known tokens"),
});

export const SellPositionSchema = z.object({
  token: z.string().describe("Token symbol or address to sell"),
  to_token: z.string().default("USDCe").describe("Token to receive e.g. USDCe, WGBTC"),
  amount: z.string().optional().describe("Amount to sell. Omit to sell full balance"),
  slippage_bps: z.coerce.number().default(50).describe("Slippage in basis points. Default 50 (0.5%)"),
  fee_tier: z.coerce.number().default(500).describe("Pool fee tier: 100, 500, 3000. Default 500"),
});

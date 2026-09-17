import { type Request, type Response } from "express";
import { gruff } from "./agent/gruff";
import { GetPortfolioSchema, SellPositionSchema, MessageSchema } from "./gruff.schema";

export async function runGruff(req: Request, res: Response): Promise<void> {
  const { action, ...params } = req.body ?? {};

  try {
    let result;

    switch (action) {
      case "execute_trade":
      case undefined:
      case null: {
        const { message } = MessageSchema.parse(req.body ?? {});
        result = await gruff.run(message);
        break;
      }

      case "get_portfolio": {
        const { extra_tokens } = GetPortfolioSchema.parse(params);
        result = await gruff.getPortfolio(extra_tokens ?? []);
        break;
      }

      case "sell_position": {
        const parsed = SellPositionSchema.parse(params);
        result = await gruff.sellPosition(
          parsed.token,
          parsed.to_token,
          parsed.amount || undefined,
          parsed.slippage_bps ? Number(parsed.slippage_bps) : 50,
          parsed.fee_tier ? Number(parsed.fee_tier) : 500,
        );
        break;
      }

      default:
        res.status(400).json({
          success: false,
          data: {},
          message: `Unknown action: "${action}". Valid: execute_trade, get_portfolio, sell_position`,
        });
        return;
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

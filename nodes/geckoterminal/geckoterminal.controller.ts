import { Request, Response } from "express";
import { newPools, tokenInfo, ohlcv, trades, trendingPools } from "./geckoterminal.actions";

export async function runGeckoTerminal(req: Request, res: Response): Promise<void> {
  const { action, ...params } = req.body ?? {};

  try {
    let data: unknown;

    switch (action) {
      case "new_pools":
        data = await newPools(params);
        break;
      case "token_info":
        data = await tokenInfo(params);
        break;
      case "ohlcv":
        data = await ohlcv(params);
        break;
      case "trades":
        data = await trades(params);
        break;
      case "trending_pools":
        data = await trendingPools(params);
        break;
      default:
        res.status(400).json({ success: false, data: {}, message: `Unknown action: "${action}". Valid actions: new_pools, token_info, ohlcv, trades, trending_pools` });
        return;
    }

    res.json({ success: true, data, message: `GeckoTerminal ${action} complete` });
  } catch (err) {
    res.status(400).json({
      success: false,
      data: {},
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

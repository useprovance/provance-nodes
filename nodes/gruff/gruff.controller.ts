import { Request, Response } from "express";
import { gruff } from "./agent/gruff";
import {
   MessageSchema,
   GetPortfolioSchema,
   SellPositionSchema,
} from "./gruff.schema";
import { getPortfolio, sellPosition } from "./gruff.actions";

export async function runGruff(req: Request, res: Response): Promise<void> {
   const { action, ...params } = req.body ?? {};

   try {
      let data: unknown;

      switch (action) {
         case "execute_trade":
         case "chat":
         case undefined:
         case null: {
            const { message } = MessageSchema.parse(req.body ?? {});
            const result = await gruff.run(message);
            res.json(result);
            return;
         }
         case "get_portfolio":
            data = await getPortfolio(GetPortfolioSchema.parse(params));
            break;
         case "sell_position":
            data = await sellPosition(SellPositionSchema.parse(params));
            break;
         default:
            res.status(400).json({
               success: false,
               data: {},
               message: `Unknown action: "${action}". Valid actions: chat, get_portfolio, sell_position`,
            });
            return;
      }

      res.json({ success: true, data, message: `Gruff ${action} complete` });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
}

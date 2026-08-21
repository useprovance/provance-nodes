import { Request, Response } from "express";
import cron from "node-cron";
import { ManualTriggerSchema, ScheduleTriggerSchema } from "./trigger.schema";
import {
   getSchedule,
   setSchedule,
   deleteSchedule,
   intervalToCron,
} from "./schedule.store";
import { logger } from "../../../../src/logger";

const CLIENT_URL = process.env.CLIENT_URL ?? "https://app.useprovance.xyz";

export async function runTrigger(req: Request, res: Response): Promise<void> {
   const { action, ...params } = req.body ?? {};

   try {
      let data: unknown;

      switch (action) {
         case "manual":
            ManualTriggerSchema.parse(params);
            data = { triggered_at: new Date().toISOString(), type: "manual" };
            break;

         case "schedule": {
            const p = ScheduleTriggerSchema.parse(params);
            data = {
               triggered_at: new Date().toISOString(),
               type: "schedule",
               interval: p.interval,
               unit: p.unit,
            };
            break;
         }

         default:
            res.status(400).json({
               success: false,
               data: {},
               message: `Unknown trigger action: "${action}"`,
            });
            return;
      }

      res.json({ success: true, data, message: `Trigger fired: ${action}` });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
}

export async function registerSchedule(
   req: Request,
   res: Response,
): Promise<void> {
   try {
      const { workflowId, interval, unit } = req.body as {
         workflowId: string;
         interval: number;
         unit: "minutes" | "hours" | "days";
      };

      if (!workflowId) {
         res.status(400).json({
            success: false,
            data: {},
            message: "workflowId is required",
         });
         return;
      }

      if (getSchedule(workflowId)) deleteSchedule(workflowId);

      const cronExpr = intervalToCron(interval ?? 5, unit ?? "minutes");

      if (!cron.validate(cronExpr)) {
         res.status(400).json({
            success: false,
            data: {},
            message: `Invalid cron expression: "${cronExpr}"`,
         });
         return;
      }

      const task = cron.schedule(cronExpr, async () => {
         logger.info({ workflowId }, `[schedule] firing workflow "${workflowId}"`);
         try {
            const res = await fetch(
               `${CLIENT_URL}/api/workflows/${workflowId}/run`,
               { method: "POST" },
            );
            const json = (await res.json()) as { success: boolean };
            logger.info({ workflowId, success: json.success }, `[schedule] workflow "${workflowId}" → ${json.success ? "ok" : "failed"}`);
         } catch (err) {
            logger.error({ workflowId, err }, `[schedule] workflow "${workflowId}" error`);
         }
      });

      setSchedule(workflowId, {
         workflowId,
         cronExpression: cronExpr,
         canvas: null,
         task,
      });

      logger.info({ workflowId, cron: cronExpr }, `[schedule] registered "${workflowId}" → ${cronExpr}`);
      res.json({
         success: true,
         data: { workflowId, cron: cronExpr },
         message: "Schedule registered",
      });
   } catch (err) {
      res.status(400).json({
         success: false,
         data: {},
         message: err instanceof Error ? err.message : "Unknown error",
      });
   }
}

export async function cancelSchedule(
   req: Request,
   res: Response,
): Promise<void> {
   const { workflowId } = req.params;
   if (getSchedule(workflowId)) {
      deleteSchedule(workflowId);
      logger.info({ workflowId }, `[schedule] cancelled "${workflowId}"`);
      res.json({ success: true, data: {}, message: "Schedule cancelled" });
   } else {
      res.status(404).json({
         success: false,
         data: {},
         message: `No schedule found for "${workflowId}"`,
      });
   }
}

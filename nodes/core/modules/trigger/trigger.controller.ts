import { Request, Response } from "express";
import { ManualTriggerSchema, ScheduleTriggerSchema, WebhookTriggerSchema } from "./trigger.schema";

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
          cron: p.cron ?? null,
        };
        break;
      }

      case "webhook": {
        const p = WebhookTriggerSchema.parse(params);
        data = {
          triggered_at: new Date().toISOString(),
          type: "webhook",
          workflow_id: p.workflow_id,
          payload: params,
        };
        break;
      }

      default:
        res.status(400).json({
          success: false,
          data: {},
          message: `Unknown trigger action: "${action}". Valid actions: manual, schedule, webhook`,
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

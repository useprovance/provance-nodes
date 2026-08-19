import { z } from "zod";

export const ManualTriggerSchema = z.object({});

export const ScheduleTriggerSchema = z.object({
  interval: z.coerce.number().min(1).describe("How often to run"),
  unit: z.enum(["minutes", "hours", "days"]).default("minutes"),
  cron: z.string().optional().describe("Custom cron expression — overrides interval/unit if provided"),
});

export const WebhookTriggerSchema = z.object({
  workflow_id: z.string().min(1).describe("The workflow ID this webhook belongs to"),
});

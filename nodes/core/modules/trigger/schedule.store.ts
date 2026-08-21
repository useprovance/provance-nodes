import type { ScheduledTask } from "node-cron";

export interface ScheduledWorkflow {
   workflowId: string;
   cronExpression: string;
   canvas: null;
   task: ScheduledTask;
}

const schedules = new Map<string, ScheduledWorkflow>();

export function getSchedule(workflowId: string) {
   return schedules.get(workflowId);
}

export function setSchedule(workflowId: string, entry: ScheduledWorkflow) {
   schedules.set(workflowId, entry);
}

export function deleteSchedule(workflowId: string) {
   const entry = schedules.get(workflowId);
   if (entry) {
      entry.task.stop();
      schedules.delete(workflowId);
   }
}

export function intervalToCron(
   interval: number,
   unit: "minutes" | "hours" | "days",
): string {
   if (unit === "minutes") return `*/${interval} * * * *`;
   if (unit === "hours") return `0 */${interval} * * *`;
   if (unit === "days") return `0 0 */${interval} * *`;
   return `*/${interval} * * * *`;
}

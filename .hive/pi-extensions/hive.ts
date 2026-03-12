// pi-extensions/hive.ts - Hive extension for Pi coding agent
import { StringEnum, Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROGRESS_STATUSES = ["working", "testing", "committing", "done"] as const;

export default function hiveExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hive_report_progress",
    label: "Hive Progress",
    description: "Report task progress to Hive monitor",
    parameters: Type.Object({
      status: StringEnum(PROGRESS_STATUSES),
      message: Type.String({ description: "Progress message" }),
    }),
    async execute(_toolCallId, params) {
      const fs = await import("node:fs");
      const { status, message } = params as {
        status: (typeof PROGRESS_STATUSES)[number];
        message: string;
      };

      const event = JSON.stringify({
        type: "progress",
        status,
        message,
        timestamp: new Date().toISOString(),
      });

      fs.appendFileSync(process.env.HIVE_EVENTS_LOG || ".hive-events.log", event + "\n");

      return {
        content: [{ type: "text", text: `Progress reported: ${status}` }],
        details: { status },
      };
    },
  });
}

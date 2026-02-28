import { logger } from "../logger.js";

export interface NtfyConfig {
  enabled: boolean;
  topic: string;
  serverUrl?: string;
  priority?: "urgent" | "high" | "default" | "low" | "min";
}

const DEFAULT_CONFIG: NtfyConfig = {
  enabled: false,
  topic: "",
  serverUrl: "https://ntfy.sh",
  priority: "default",
};

export async function sendNotification(
  config: NtfyConfig | undefined,
  title: string,
  message: string,
  priority?: NtfyConfig["priority"],
  tags?: string[],
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled || !cfg.topic) return;

  const log = logger.child({ component: "ntfy" });
  try {
    const res = await fetch(`${cfg.serverUrl}/${cfg.topic}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: priority ?? cfg.priority ?? "default",
        Tags: (tags ?? []).join(","),
      },
      body: message,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "ntfy notification failed");
    }
  } catch (err: unknown) {
    log.warn({ err: String(err) }, "ntfy notification error");
  }
}

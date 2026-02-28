import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendNotification, type NtfyConfig } from "../../src/notifications/ntfy.js";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("sendNotification", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
  });

  it("does NOT call fetch when disabled", async () => {
    const config: NtfyConfig = {
      enabled: false,
      topic: "test-topic",
      serverUrl: "https://ntfy.sh",
      priority: "default",
    };

    await sendNotification(config, "Title", "Message");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when topic is empty", async () => {
    const config: NtfyConfig = {
      enabled: true,
      topic: "",
      serverUrl: "https://ntfy.sh",
      priority: "default",
    };

    await sendNotification(config, "Title", "Message");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns without action when config is undefined", async () => {
    await sendNotification(undefined, "Title", "Message");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls fetch with correct URL and headers when enabled", async () => {
    const config: NtfyConfig = {
      enabled: true,
      topic: "my-topic",
      serverUrl: "https://ntfy.sh",
      priority: "default",
    };

    await sendNotification(config, "Test Title", "Test body", "high", [
      "warning",
      "fire",
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/my-topic");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("Test body");

    const headers = opts.headers as Record<string, string>;
    expect(headers.Title).toBe("Test Title");
    expect(headers.Priority).toBe("high");
    expect(headers.Tags).toBe("warning,fire");
  });

  it("uses config priority when no override is given", async () => {
    const config: NtfyConfig = {
      enabled: true,
      topic: "my-topic",
      serverUrl: "https://ntfy.sh",
      priority: "low",
    };

    await sendNotification(config, "Title", "Body");

    const headers = (fetchSpy.mock.calls[0] as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Priority).toBe("low");
  });

  it("logs warning when fetch returns non-ok status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("err", { status: 500 }));
    const config: NtfyConfig = {
      enabled: true,
      topic: "my-topic",
      serverUrl: "https://ntfy.sh",
      priority: "default",
    };

    // Should not throw
    await expect(
      sendNotification(config, "Title", "Body"),
    ).resolves.toBeUndefined();
  });

  it("logs warning and does NOT throw when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));
    const config: NtfyConfig = {
      enabled: true,
      topic: "my-topic",
      serverUrl: "https://ntfy.sh",
      priority: "default",
    };

    await expect(
      sendNotification(config, "Title", "Body"),
    ).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { DashboardWebServer, type DashboardServerOptions } from "../../src/dashboard/ws-server.js";
import { SprintEventBus } from "../../src/tui/events.js";
import type { SprintState } from "../../src/runner.js";

/** Poll until `check()` returns true, rejecting after `timeoutMs`. */
function waitForCondition(check: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (check()) { clearInterval(poll); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(poll); reject(new Error("Timeout waiting for condition")); }
    }, intervalMs);
  });
}

function makeOptions(overrides?: Partial<DashboardServerOptions>): DashboardServerOptions {
  const bus = new SprintEventBus();
  const state: SprintState = {
    version: "1",
    sprintNumber: 1,
    phase: "init",
    startedAt: new Date(),
  };
  return {
    port: 0, // random available port
    host: "127.0.0.1",
    eventBus: bus,
    getState: () => state,
    getIssues: () => [
      { number: 1, title: "Test issue", status: "planned" },
    ],
    ...overrides,
  };
}

function getPort(server: DashboardWebServer): number {
  // Access internal server to get assigned port
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addr = (server as any).server?.address();
  return addr?.port ?? 0;
}

describe("DashboardWebServer", () => {
  let server: DashboardWebServer;
  let options: DashboardServerOptions;

  beforeEach(() => {
    options = makeOptions();
    server = new DashboardWebServer(options);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("starts and stops without error", async () => {
    await server.start();
    const port = getPort(server);
    expect(port).toBeGreaterThan(0);
    await server.stop();
  });

  it("serves index.html for root path", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sprint Runner");
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("serves CSS file", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("sends initial state on WebSocket connect", async () => {
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
    });

    // First message: sprint state
    expect(messages[0]).toMatchObject({
      type: "sprint:state",
      payload: { sprintNumber: 1, phase: "init" },
    });

    // Second message: issues
    expect(messages[1]).toMatchObject({
      type: "sprint:issues",
      payload: [{ number: 1, title: "Test issue", status: "planned" }],
    });
  });

  it("relays event bus events to WebSocket clients", async () => {
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const events: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      let initialCount = 0;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "sprint:state" || msg.type === "sprint:issues") {
          initialCount++;
          // After initial messages, emit an event
          if (initialCount === 2) {
            options.eventBus.emitTyped("log", { level: "info", message: "test log" });
          }
          return;
        }
        events.push(msg);
        ws.close();
        resolve();
      });
      ws.on("error", reject);
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
    });

    expect(events[0]).toMatchObject({
      type: "sprint:event",
      eventName: "log",
      payload: { level: "info", message: "test log" },
    });
  });

  it("handles client sprint:start message", async () => {
    let started = false;
    options.onStart = () => { started = true; };
    server = new DashboardWebServer(options);

    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "sprint:start" }));
      });
      ws.on("error", reject);
      waitForCondition(() => started)
        .then(() => { ws.close(); resolve(); })
        .catch(() => { ws.close(); reject(new Error("timeout waiting for sprint:start handler")); });
    });

    expect(started).toBe(true);
  });

  it("returns 403 for directory traversal attempts", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/../../package.json`);
    // Should return index.html (SPA fallback) or 403, not the actual file
    expect(res.status).not.toBe(500);
    const text = await res.text();
    expect(text).not.toContain('"dependencies"');
  });

  it("serves /api/sprints with available sprints", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string; isActive: boolean }[];
    // Should at least include the active sprint from getState
    expect(Array.isArray(data)).toBe(true);
  });

  it("serves /api/sprints/:number/state for active sprint", async () => {
    options = makeOptions({ activeSprintNumber: 1 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/1/state`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string };
    expect(data.sprintNumber).toBe(1);
    expect(data.phase).toBe("init");
  });

  it("returns empty state for nonexistent sprint", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/999/state`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string };
    expect(data.sprintNumber).toBe(999);
    expect(data.phase).toBe("init");
  });

  it("serves /api/sprints/history", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/history`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  // --- Sprint navigation edge cases ---

  it("/api/sprints includes active sprint even without state files", async () => {
    options = makeOptions({ activeSprintNumber: 3 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints`);
    const data = await res.json() as { sprintNumber: number; isActive: boolean }[];
    const active = data.find((s) => s.sprintNumber === 3);
    expect(active).toBeDefined();
    expect(active!.isActive).toBe(true);
  });

  it("/api/sprints fills gaps from 1 to active sprint", async () => {
    options = makeOptions({ activeSprintNumber: 3 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints`);
    const data = await res.json() as { sprintNumber: number }[];
    const numbers = data.map((s) => s.sprintNumber);
    // Should have sprint 1, 2, 3 (gaps filled)
    expect(numbers).toContain(1);
    expect(numbers).toContain(2);
    expect(numbers).toContain(3);
  });

  it("/api/sprints/999/state returns init state for sprint without state file", async () => {
    options = makeOptions({ activeSprintNumber: 2 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/999/state`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string };
    expect(data.sprintNumber).toBe(999);
    expect(data.phase).toBe("init");
  });

  it("/api/sprints returns sorted sprints", async () => {
    options = makeOptions({ activeSprintNumber: 5 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints`);
    const data = await res.json() as { sprintNumber: number }[];
    for (let i = 1; i < data.length; i++) {
      expect(data[i].sprintNumber).toBeGreaterThan(data[i - 1].sprintNumber);
    }
  });

  it("returns 404 for unknown API routes", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/unknown`);
    expect(res.status).toBe(404);
  });

  it("serves /api/repo with repo URL", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/repo`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("url");
  });

  it("serves /api/sprints/:n/issues from cache", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/1/issues`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("serves /api/sessions with empty list initially", async () => {
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("tracks sessions via event bus and serves them via API", async () => {
    await server.start();
    const port = getPort(server);
    const bus = options.eventBus;

    // Emit session:start
    bus.emitTyped("session:start", {
      sessionId: "test-session-1",
      role: "worker",
      issueNumber: 42,
      model: "gpt-4",
    });

    // Check session appears in API
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    const data = await res.json() as { sessionId: string; role: string; issueNumber: number }[];
    expect(data).toHaveLength(1);
    expect(data[0].sessionId).toBe("test-session-1");
    expect(data[0].role).toBe("worker");
    expect(data[0].issueNumber).toBe(42);

    // Emit session:end
    bus.emitTyped("session:end", { sessionId: "test-session-1" });

    // Session should still be in list but with endedAt
    const res2 = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    const data2 = await res2.json() as { endedAt: number | undefined }[];
    expect(data2).toHaveLength(1);
    expect(data2[0].endedAt).toBeDefined();
  });

  // --- Event buffer & sprint switch ---

  it("sends fresh state and issues on sprint:switch", async () => {
    options = makeOptions({ activeSprintNumber: 2 });
    const state: SprintState = { version: "1", sprintNumber: 2, phase: "execute", startedAt: new Date() };
    options.getState = () => state;
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);

    // Connect and wait for initial messages, then send sprint:switch
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const allMessages: { type: string; eventName?: string; payload?: unknown }[] = [];

    await new Promise<void>((resolve, reject) => {
      let initialCount = 0;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (initialCount < 2) {
          initialCount++;
          if (initialCount === 2) {
            // Send sprint:switch after initial messages
            ws.send(JSON.stringify({ type: "sprint:switch", sprintNumber: 2 }));
          }
          return;
        }
        allMessages.push(msg);
        // Expect: sprint:state + sprint:issues = 2 messages
        if (allMessages.length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
    });

    // Should receive fresh state and issues
    expect(allMessages[0].type).toBe("sprint:state");
    expect(allMessages[1].type).toBe("sprint:issues");
  });

  it("broadcasts updated issues on sprint:planned event", async () => {
    const testIssues = [
      { number: 10, title: "Test Issue", status: "planned" },
    ];
    options = makeOptions({ activeSprintNumber: 1 });
    options.getIssues = () => testIssues;
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const receivedIssues: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      let initialCount = 0;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (initialCount < 2) {
          initialCount++;
          if (initialCount === 2) {
            // Emit sprint:planned after initial messages received
            options.eventBus.emitTyped("sprint:planned", {
              issues: [{ number: 10, title: "Test Issue" }],
            });
          }
          return;
        }
        // After initial: expect sprint:event for sprint:planned, then sprint:issues broadcast
        if (msg.type === "sprint:issues") {
          receivedIssues.push(msg.payload);
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
    });

    expect(receivedIssues).toHaveLength(1);
    expect(receivedIssues[0]).toEqual(testIssues);
  });

  it("state API returns 'complete' for sprint with log file but no state file", async () => {
    // Create a temp dir with a log file but no state file
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tmpDir = mkdtempSync(join(import.meta.dirname ?? ".", "sprint-state-test-"));
    const sprintsDir = join(tmpDir, "docs", "sprints");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sprintsDir, { recursive: true });
    // Write a log file for sprint 1 (no state file)
    writeFileSync(join(sprintsDir, "sprint-1-log.md"), "# Sprint 1 Log\n");

    options = makeOptions({ activeSprintNumber: 5, projectPath: tmpDir, sprintSlug: "sprint" });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/1/state`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string };
    expect(data.sprintNumber).toBe(1);
    expect(data.phase).toBe("complete");

    // Cleanup
    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

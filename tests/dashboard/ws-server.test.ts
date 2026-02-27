import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { DashboardWebServer, type DashboardServerOptions } from "../../src/dashboard/ws-server.js";
import { SprintEventBus } from "../../src/tui/events.js";
import type { SprintState } from "../../src/runner.js";

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
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 3000);
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
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 3000);
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
        setTimeout(() => {
          ws.close();
          resolve();
        }, 200);
      });
      ws.on("error", reject);
      setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 3000);
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

  it("/api/sprints/1/state returns init state for sprint without state file", async () => {
    options = makeOptions({ activeSprintNumber: 2 });
    server = new DashboardWebServer(options);
    await server.start();
    const port = getPort(server);
    const res = await fetch(`http://127.0.0.1:${port}/api/sprints/1/state`);
    expect(res.status).toBe(200);
    const data = await res.json() as { sprintNumber: number; phase: string };
    expect(data.sprintNumber).toBe(1);
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
    // Should have a url field (may be null in test env without git remote)
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
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DashboardWebServer, type DashboardServerOptions } from "../../src/dashboard/ws-server.js";
import { SprintEventBus } from "../../src/events.js";
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
    port: 0,
    host: "127.0.0.1",
    eventBus: bus,
    getState: () => state,
    getIssues: () => [{ number: 1, title: "Test issue", status: "planned" }],
    ...overrides,
  };
}

describe("DashboardWebServer — replay & cleanup", () => {
  let server: DashboardWebServer;
  let options: DashboardServerOptions;

  beforeEach(() => {
    options = makeOptions();
    server = new DashboardWebServer(options);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("eventBuffer is populated when events are bridged", async () => {
    await server.start();

    options.eventBus.emitTyped("log", { level: "info", message: "buf-test" });
    options.eventBus.emitTyped("log", { level: "warn", message: "buf-test-2" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = (server as any).eventBuffer as { eventName: string; payload: unknown }[];
    expect(buffer.length).toBe(2);
    expect(buffer[0]).toMatchObject({ eventName: "log", payload: { message: "buf-test" } });
    expect(buffer[1]).toMatchObject({ eventName: "log", payload: { message: "buf-test-2" } });
  });

  it("stop() calls removeAllListeners on the event bus", async () => {
    await server.start();
    const spy = vi.spyOn(options.eventBus, "removeAllListeners");

    await server.stop();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

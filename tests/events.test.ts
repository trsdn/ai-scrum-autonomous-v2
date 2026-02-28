import { describe, it, expect } from "vitest";
import { SprintEventBus } from "../src/events.js";

describe("SprintEventBus", () => {
  it("can be imported from src/events.js", () => {
    expect(SprintEventBus).toBeDefined();
    expect(new SprintEventBus()).toBeInstanceOf(SprintEventBus);
  });

  it("emitTyped/onTyped round-trip delivers typed payload", () => {
    const bus = new SprintEventBus();
    let received: { level: string; message: string } | undefined;

    bus.onTyped("log", (payload) => {
      received = payload;
    });

    bus.emitTyped("log", { level: "info", message: "hello" });

    expect(received).toEqual({ level: "info", message: "hello" });
  });

  it("supports multiple listeners on the same event", () => {
    const bus = new SprintEventBus();
    const calls: string[] = [];

    bus.onTyped("log", () => calls.push("a"));
    bus.onTyped("log", () => calls.push("b"));

    bus.emitTyped("log", { level: "warn", message: "test" });

    expect(calls).toEqual(["a", "b"]);
  });
});

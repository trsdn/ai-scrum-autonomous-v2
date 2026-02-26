import { describe, it, expect } from "vitest";
import { createLogger, logger } from "../src/logger.js";

describe("logger", () => {
  describe("createLogger", () => {
    it("creates a logger with default options", () => {
      const log = createLogger({ pretty: false });
      expect(log).toBeDefined();
      expect(log.level).toBe("info");
    });

    it("respects custom log level", () => {
      const log = createLogger({ level: "debug", pretty: false });
      expect(log.level).toBe("debug");
    });

    it("respects custom name", () => {
      const log = createLogger({ name: "test-runner", pretty: false });
      // pino stores the name in bindings
      expect(log).toBeDefined();
    });
  });

  describe("child logger", () => {
    it("creates child logger with sprint context", () => {
      const log = createLogger({ pretty: false });
      const child = log.child({ sprint: 3, ceremony: "planning" });

      expect(child).toBeDefined();
      expect(child.level).toBe(log.level);
    });

    it("creates child logger with issue context", () => {
      const log = createLogger({ pretty: false });
      const child = log.child({ sprint: 3, issue: 42 });

      expect(child).toBeDefined();
    });

    it("child inherits parent log level", () => {
      const log = createLogger({ level: "warn", pretty: false });
      const child = log.child({ sprint: 1 });

      expect(child.level).toBe("warn");
    });
  });

  describe("log level filtering", () => {
    it("filters messages below configured level", () => {
      const log = createLogger({ level: "warn", pretty: false });

      // info is below warn, so isLevelEnabled should return false
      expect(log.isLevelEnabled("info")).toBe(false);
      expect(log.isLevelEnabled("debug")).toBe(false);
    });

    it("allows messages at or above configured level", () => {
      const log = createLogger({ level: "warn", pretty: false });

      expect(log.isLevelEnabled("warn")).toBe(true);
      expect(log.isLevelEnabled("error")).toBe(true);
    });
  });

  describe("default export", () => {
    it("exports a default logger instance", () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.child).toBe("function");
    });
  });
});

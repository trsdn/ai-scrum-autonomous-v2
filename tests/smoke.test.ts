import { describe, it, expect } from "vitest";

describe("Sprint Runner CLI", () => {
  it("should export core modules", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { createLogger } = await import("../src/logger.js");
    const { AcpClient } = await import("../src/acp/client.js");

    expect(loadConfig).toBeTypeOf("function");
    expect(createLogger).toBeTypeOf("function");
    expect(AcpClient).toBeTypeOf("function");
  });
});

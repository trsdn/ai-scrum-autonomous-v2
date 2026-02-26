import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionPool } from "../../src/acp/session-pool.js";
import type { AcpClient } from "../../src/acp/client.js";

vi.mock("../../src/logger.js", () => {
  const noopLogger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  noopLogger["child"] = vi.fn(() => noopLogger);
  return { logger: noopLogger, createLogger: vi.fn(() => noopLogger) };
});

function createMockClient(): AcpClient {
  let counter = 0;
  return {
    createSession: vi.fn(async () => `session-${++counter}`),
    endSession: vi.fn(async () => {}),
  } as unknown as AcpClient;
}

describe("SessionPool", () => {
  let client: AcpClient;
  let pool: SessionPool;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    pool = new SessionPool(client, 2, 60_000);
  });

  describe("getStats", () => {
    it("returns initial stats", () => {
      expect(pool.getStats()).toEqual({ active: 0, available: 2, total: 2 });
    });

    it("reflects acquired sessions", async () => {
      await pool.acquire({ cwd: "/tmp" });
      expect(pool.getStats()).toEqual({ active: 1, available: 1, total: 2 });
    });

    it("reflects released sessions", async () => {
      const session = await pool.acquire({ cwd: "/tmp" });
      await pool.release(session.sessionId);
      expect(pool.getStats()).toEqual({ active: 0, available: 2, total: 2 });
    });
  });

  describe("concurrency limiting", () => {
    it("allows up to maxConcurrency sessions", async () => {
      await pool.acquire({ cwd: "/a" });
      await pool.acquire({ cwd: "/b" });
      expect(pool.getStats().active).toBe(2);
    });

    it("blocks when pool is full and unblocks on release", async () => {
      const s1 = await pool.acquire({ cwd: "/a" });
      await pool.acquire({ cwd: "/b" });

      let acquired = false;
      const acquirePromise = pool.acquire({ cwd: "/c" }).then((s) => {
        acquired = true;
        return s;
      });

      // Give microtasks a chance to resolve
      await new Promise((r) => setTimeout(r, 50));
      expect(acquired).toBe(false);
      expect(pool.getStats().active).toBe(2);

      await pool.release(s1.sessionId);
      const s3 = await acquirePromise;
      expect(acquired).toBe(true);
      expect(s3.sessionId).toBeDefined();
      expect(pool.getStats().active).toBe(2);
    });
  });

  describe("acquire", () => {
    it("returns a PooledSession with sessionId and createdAt", async () => {
      const session = await pool.acquire({ cwd: "/tmp" });
      expect(session.sessionId).toBe("session-1");
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("passes options to client.createSession", async () => {
      const mcpServers = [{ command: "gh", args: ["mcp-server"] }];
      await pool.acquire({ cwd: "/project", mcpServers });
      expect(client.createSession).toHaveBeenCalledWith({
        cwd: "/project",
        mcpServers,
      });
    });
  });

  describe("release", () => {
    it("calls client.endSession", async () => {
      const session = await pool.acquire({ cwd: "/tmp" });
      await pool.release(session.sessionId);
      expect(client.endSession).toHaveBeenCalledWith(session.sessionId);
    });

    it("ignores unknown session ids", async () => {
      await pool.release("nonexistent");
      expect(client.endSession).not.toHaveBeenCalled();
    });
  });

  describe("executeInSession", () => {
    it("acquires, runs function, and releases on success", async () => {
      const result = await pool.executeInSession(
        { cwd: "/tmp" },
        async (sessionId) => {
          expect(pool.getStats().active).toBe(1);
          return `done-${sessionId}`;
        },
      );

      expect(result).toBe("done-session-1");
      expect(pool.getStats().active).toBe(0);
      expect(client.endSession).toHaveBeenCalledTimes(1);
    });

    it("releases session even when function throws", async () => {
      await expect(
        pool.executeInSession({ cwd: "/tmp" }, async () => {
          throw new Error("task failed");
        }),
      ).rejects.toThrow("task failed");

      expect(pool.getStats().active).toBe(0);
      expect(client.endSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("drainAll", () => {
    it("ends all active sessions", async () => {
      await pool.acquire({ cwd: "/a" });
      await pool.acquire({ cwd: "/b" });
      expect(pool.getStats().active).toBe(2);

      await pool.drainAll();
      expect(pool.getStats().active).toBe(0);
      expect(client.endSession).toHaveBeenCalledTimes(2);
    });

    it("handles empty pool", async () => {
      await pool.drainAll();
      expect(pool.getStats().active).toBe(0);
      expect(client.endSession).not.toHaveBeenCalled();
    });

    it("unblocks waiters after draining", async () => {
      const s1 = await pool.acquire({ cwd: "/a" });
      await pool.acquire({ cwd: "/b" });

      let acquired = false;
      const acquirePromise = pool.acquire({ cwd: "/c" }).then((s) => {
        acquired = true;
        return s;
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(acquired).toBe(false);

      // drainAll should free slots and wake waiters
      await pool.drainAll();
      const s3 = await acquirePromise;
      expect(acquired).toBe(true);
      expect(s3.sessionId).toBeDefined();
    });
  });
});

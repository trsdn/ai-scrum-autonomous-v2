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
    createSession: vi.fn(async () => ({
      sessionId: `session-${++counter}`,
      availableModes: [],
      currentMode: "",
      availableModels: [],
      currentModel: "",
    })),
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

  describe("acquire error handling (deadlock prevention)", () => {
    it("pool stays functional after createSession throws", async () => {
      const err = new Error("session creation failed");
      vi.mocked(client.createSession)
        .mockRejectedValueOnce(err);

      await expect(pool.acquire({ cwd: "/tmp" })).rejects.toThrow(
        "session creation failed",
      );

      // Pool should still be usable
      expect(pool.getStats().active).toBe(0);
      const session = await pool.acquire({ cwd: "/tmp" });
      expect(session.sessionId).toBeDefined();
      expect(pool.getStats().active).toBe(1);
    });

    it("unblocks next waiter when createSession throws at capacity", async () => {
      // Fill pool to capacity
      await pool.acquire({ cwd: "/a" });
      await pool.acquire({ cwd: "/b" });

      // Queue two waiters
      let waiter1Resolved = false;
      const waiter1 = pool.acquire({ cwd: "/c" }).then((s) => {
        waiter1Resolved = true;
        return s;
      });

      let waiter2Resolved = false;
      const waiter2 = pool.acquire({ cwd: "/d" }).then((s) => {
        waiter2Resolved = true;
        return s;
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(waiter1Resolved).toBe(false);
      expect(waiter2Resolved).toBe(false);

      // Make createSession fail for the next call, then succeed after
      vi.mocked(client.createSession)
        .mockRejectedValueOnce(new Error("boom"));

      // Release one slot — waiter1 wakes up, createSession fails,
      // waiter1 rejects but must wake waiter2
      await pool.release("session-1");

      await expect(waiter1).rejects.toThrow("boom");
      await new Promise((r) => setTimeout(r, 50));

      // Release second slot so waiter2 can proceed
      await pool.release("session-2");
      const s = await waiter2;
      expect(waiter2Resolved).toBe(true);
      expect(s.sessionId).toBeDefined();
    });

    it("multiple consecutive failures don't leak slots", async () => {
      vi.mocked(client.createSession)
        .mockRejectedValueOnce(new Error("fail-1"))
        .mockRejectedValueOnce(new Error("fail-2"))
        .mockRejectedValueOnce(new Error("fail-3"));

      await expect(pool.acquire({ cwd: "/a" })).rejects.toThrow("fail-1");
      await expect(pool.acquire({ cwd: "/b" })).rejects.toThrow("fail-2");
      await expect(pool.acquire({ cwd: "/c" })).rejects.toThrow("fail-3");

      // All slots should still be available
      expect(pool.getStats()).toEqual({ active: 0, available: 2, total: 2 });

      // Pool should still work
      const session = await pool.acquire({ cwd: "/d" });
      expect(session.sessionId).toBeDefined();
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
      await pool.acquire({ cwd: "/a" });
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

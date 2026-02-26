import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";

// Mock child_process before importing modules that use it
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock the SDK to avoid real connections
const mockInitialize = vi.fn();
const mockNewSession = vi.fn();
const mockPrompt = vi.fn();
vi.mock("@agentclientprotocol/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentclientprotocol/sdk")>();
  return {
    ...actual,
    ClientSideConnection: vi.fn().mockImplementation((toClient: (...args: unknown[]) => void) => {
      // Capture the client handler for later use
      const fakeAgent = {};
      const clientHandler = toClient(fakeAgent);
      return {
        initialize: mockInitialize,
        newSession: mockNewSession,
        prompt: mockPrompt,
        signal: new AbortController().signal,
        closed: new Promise(() => {}),
        _clientHandler: clientHandler,
      };
    }),
    ndJsonStream: vi.fn().mockReturnValue({
      writable: new WritableStream(),
      readable: new ReadableStream(),
    }),
  };
});

import { AcpClient } from "../../src/acp/client.js";
import {
  createPermissionHandler,
} from "../../src/acp/permissions.js";
import { createLogger } from "../../src/logger.js";

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });

  Object.assign(proc, {
    stdin,
    stdout,
    stderr,
    pid: 12345,
    killed: false,
    kill: vi.fn().mockImplementation(function (this: { killed: boolean }) {
      this.killed = true;
      proc.emit("exit", 0, null);
      return true;
    }),
    connected: true,
    disconnect: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
    send: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  });

  return proc as unknown as ChildProcess;
}

describe("AcpClient", () => {
  const silentLogger = createLogger({ level: "error", pretty: false });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue({
      protocolVersion: 1,
      agentInfo: { name: "copilot", version: "1.0.0" },
    });
    mockNewSession.mockResolvedValue({
      sessionId: "session-123",
      modes: {
        availableModes: [{ id: "agent", name: "Agent" }, { id: "plan", name: "Plan" }],
        currentModeId: "agent",
      },
      models: {
        availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
        currentModelId: "claude-sonnet-4.6",
      },
    });
    mockPrompt.mockResolvedValue({
      stopReason: "end_turn",
    });
  });

  describe("constructor", () => {
    it("creates an instance with default options", () => {
      const client = new AcpClient({ logger: silentLogger });
      expect(client).toBeDefined();
      expect(client.connected).toBe(false);
    });

    it("accepts custom options", () => {
      const client = new AcpClient({
        command: "/usr/local/bin/copilot",
        args: ["--verbose"],
        timeoutMs: 30_000,
        logger: silentLogger,
        permissions: { autoApprove: false, allowPatterns: [] },
      });
      expect(client).toBeDefined();
      expect(client.connected).toBe(false);
    });
  });

  describe("connect / disconnect", () => {
    it("spawns copilot process on connect", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();

      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        ["--acp", "--stdio"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
      expect(client.connected).toBe(true);
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ protocolVersion: 1 }),
      );

      await client.disconnect();
    });

    it("passes extra args before --acp --stdio", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({
        command: "/opt/copilot",
        args: ["--verbose"],
        logger: silentLogger,
      });
      await client.connect();

      expect(mockSpawn).toHaveBeenCalledWith(
        "/opt/copilot",
        ["--verbose", "--acp", "--stdio"],
        expect.any(Object),
      );

      await client.disconnect();
    });

    it("throws if connect called twice", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();

      await expect(client.connect()).rejects.toThrow("already connected");

      await client.disconnect();
    });

    it("kills process on disconnect", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();
      expect(client.connected).toBe(true);

      await client.disconnect();
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(client.connected).toBe(false);
    });

    it("handles disconnect when not connected", async () => {
      const client = new AcpClient({ logger: silentLogger });
      // Should not throw
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it("disconnect during connect waits then disconnects cleanly", async () => {
      const mockProc = createMockProcess();

      // Make initialize slow so connect() is in progress when disconnect() is called
      let resolveInit!: (value: unknown) => void;
      mockInitialize.mockImplementation(
        () => new Promise((resolve) => { resolveInit = resolve; }),
      );

      mockSpawn.mockReturnValue(mockProc);
      const client = new AcpClient({ logger: silentLogger });

      const connectPromise = client.connect();

      // disconnect() while connect() is still awaiting initialize
      const disconnectPromise = client.disconnect();

      // Finish the connection
      resolveInit({
        protocolVersion: 1,
        agentInfo: { name: "copilot", version: "1.0.0" },
      });

      await connectPromise;
      await disconnectPromise;

      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(client.connected).toBe(false);
    });

    it("multiple concurrent connect calls reuse the same connection", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });

      const p1 = client.connect();
      const p2 = client.connect();

      await Promise.all([p1, p2]);

      // spawn should only be called once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(client.connected).toBe(true);

      await client.disconnect();
    });
  });

  describe("createSession", () => {
    it("creates a session with cwd", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();

      const sessionInfo = await client.createSession({ cwd: "/tmp/project" });

      expect(sessionInfo.sessionId).toBe("session-123");
      expect(sessionInfo.availableModes).toEqual(["agent", "plan"]);
      expect(sessionInfo.currentModel).toBe("claude-sonnet-4.6");
      expect(mockNewSession).toHaveBeenCalledWith({
        cwd: "/tmp/project",
        mcpServers: [],
      });

      await client.disconnect();
    });

    it("passes MCP servers to session", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();

      const mcpServers = [
        { type: "stdio" as const, command: "gh", args: ["mcp-server"] },
      ];
      await client.createSession({ cwd: "/tmp", mcpServers });

      expect(mockNewSession).toHaveBeenCalledWith({
        cwd: "/tmp",
        mcpServers,
      });

      await client.disconnect();
    });

    it("throws when not connected", async () => {
      const client = new AcpClient({ logger: silentLogger });
      await expect(client.createSession({ cwd: "/tmp" })).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("sendPrompt", () => {
    it("sends prompt and returns result", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      const result = await client.sendPrompt("session-123", "Hello");

      expect(mockPrompt).toHaveBeenCalledWith({
        sessionId: "session-123",
        prompt: [{ type: "text", text: "Hello" }],
      });
      expect(result.stopReason).toBe("end_turn");
      expect(result.response).toBe("");

      await client.disconnect();
    });

    it("throws when not connected", async () => {
      const client = new AcpClient({ logger: silentLogger });
      await expect(
        client.sendPrompt("session-123", "test"),
      ).rejects.toThrow("not connected");
    });

    it("rejects on timeout", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      // Make prompt hang
      mockPrompt.mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      const client = new AcpClient({ logger: silentLogger, timeoutMs: 50 });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      await expect(
        client.sendPrompt("session-123", "slow prompt"),
      ).rejects.toThrow("timed out");

      await client.disconnect();
    });

    it("rejects immediately when process exits during sendPrompt", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      // Make prompt hang forever (simulates in-flight request)
      mockPrompt.mockImplementation(() => new Promise(() => {}));

      const client = new AcpClient({ logger: silentLogger, timeoutMs: 60_000 });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      const promptPromise = client.sendPrompt("session-123", "test");

      // Simulate process crash
      (mockProc as unknown as EventEmitter).emit("exit", 1, null);

      await expect(promptPromise).rejects.toThrow("ACP process exited unexpectedly");
    });

    it("rejects all concurrent sendPrompt calls when process exits", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      // Make prompt hang forever
      mockPrompt.mockImplementation(() => new Promise(() => {}));

      const client = new AcpClient({ logger: silentLogger, timeoutMs: 60_000 });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      const p1 = client.sendPrompt("session-123", "prompt 1");
      const p2 = client.sendPrompt("session-123", "prompt 2");
      const p3 = client.sendPrompt("session-123", "prompt 3");

      // Simulate process crash
      (mockProc as unknown as EventEmitter).emit("exit", 1, "SIGKILL");

      await expect(p1).rejects.toThrow("ACP process exited unexpectedly");
      await expect(p2).rejects.toThrow("ACP process exited unexpectedly");
      await expect(p3).rejects.toThrow("ACP process exited unexpectedly");
    });

    it("normal sendPrompt still works after fix", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      mockPrompt.mockResolvedValue({ stopReason: "end_turn" });

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      const result = await client.sendPrompt("session-123", "Hello");
      expect(result.stopReason).toBe("end_turn");
      expect(result.response).toBe("");

      // Second prompt also works
      const result2 = await client.sendPrompt("session-123", "World");
      expect(result2.stopReason).toBe("end_turn");

      await client.disconnect();
    });
  });

  describe("endSession", () => {
    it("cleans up session state", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const client = new AcpClient({ logger: silentLogger });
      await client.connect();
      await client.createSession({ cwd: "/tmp" });

      // Should not throw
      await expect(
        client.endSession("session-123"),
      ).resolves.toBeUndefined();

      await client.disconnect();
    });
  });
});

describe("createPermissionHandler", () => {
  const silentLogger = createLogger({ level: "error", pretty: false });

  const makeRequest = (
    toolName: string,
    optionKinds: Array<"allow_once" | "allow_always" | "reject_once" | "reject_always">,
  ) => ({
    sessionId: "session-1",
    toolCall: { name: toolName, id: "tc-1" },
    options: optionKinds.map((kind, i) => ({
      optionId: `opt-${kind}-${i}`,
      kind,
      name: `${kind} option`,
    })),
  });

  it("auto-approves when autoApprove is true", async () => {
    const handler = createPermissionHandler(
      { autoApprove: true, allowPatterns: [] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", ["allow_once", "reject_once"]) as any,
    );

    expect(result.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-allow_once-0",
    });
  });

  it("rejects when autoApprove is false and no pattern match", async () => {
    const handler = createPermissionHandler(
      { autoApprove: false, allowPatterns: [] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", ["allow_once", "reject_once"]) as any,
    );

    expect(result.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-reject_once-1",
    });
  });

  it("approves via pattern match", async () => {
    const handler = createPermissionHandler(
      { autoApprove: false, allowPatterns: ["bash", "edit"] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", ["allow_once", "reject_once"]) as any,
    );

    expect(result.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-allow_once-0",
    });
  });

  it("rejects when pattern does not match", async () => {
    const handler = createPermissionHandler(
      { autoApprove: false, allowPatterns: ["edit"] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", ["allow_once", "reject_once"]) as any,
    );

    expect(result.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-reject_once-1",
    });
  });

  it("cancels when no suitable options available", async () => {
    const handler = createPermissionHandler(
      { autoApprove: false, allowPatterns: [] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", []) as any,
    );

    expect(result.outcome).toEqual({ outcome: "cancelled" });
  });

  it("prefers allow_once over allow_always", async () => {
    const handler = createPermissionHandler(
      { autoApprove: true, allowPatterns: [] },
      silentLogger,
    );

    const result = await handler(
      makeRequest("bash", ["allow_always", "allow_once"]) as any,
    );

    // allow_once should be preferred (found first by find)
    expect(result.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-allow_once-1",
    });
  });
});

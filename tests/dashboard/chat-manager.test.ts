import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AcpClient before importing ChatManager
vi.mock("../../src/acp/client.js", () => {
  const AcpClient = vi.fn();
  AcpClient.prototype.connect = vi.fn().mockResolvedValue(undefined);
  AcpClient.prototype.createSession = vi.fn().mockResolvedValue({
    sessionId: "acp-session-1",
    availableModes: [],
    currentMode: "agent",
    availableModels: ["gpt-4"],
    currentModel: "gpt-4",
  });
  AcpClient.prototype.setMode = vi.fn().mockResolvedValue(undefined);
  AcpClient.prototype.sendPrompt = vi.fn().mockResolvedValue({
    response: "Hello from assistant",
    stopReason: "end",
  });
  AcpClient.prototype.endSession = vi.fn().mockResolvedValue(undefined);
  AcpClient.prototype.disconnect = vi.fn().mockResolvedValue(undefined);

  return {
    AcpClient,
    ACP_MODES: {
      AGENT: "https://agentclientprotocol.com/protocol/session-modes#agent",
      PLAN: "https://agentclientprotocol.com/protocol/session-modes#plan",
      AUTOPILOT: "https://agentclientprotocol.com/protocol/session-modes#autopilot",
    },
  };
});

// Mock fs to avoid real file reads
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue("# Agent Instructions\nDefault role context for testing"),
    readdirSync: vi.fn().mockReturnValue([
      { name: "copilot-instructions.md", isDirectory: () => false, isFile: () => true },
    ]),
  };
});

import { ChatManager, type ChatRole } from "../../src/dashboard/chat-manager.js";
import { AcpClient } from "../../src/acp/client.js";
import * as fs from "node:fs";

describe("ChatManager", () => {
  let manager: ChatManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: role folder exists with a copilot-instructions.md
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "copilot-instructions.md", isDirectory: () => false, isFile: () => true } as unknown as fs.Dirent,
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue("# Agent Instructions\nDefault role context for testing");
    manager = new ChatManager({ projectPath: "/tmp/test-project" });
  });

  describe("createSession", () => {
    it("creates a session with the given role", async () => {
      const session = await manager.createSession("researcher");

      expect(session.role).toBe("researcher");
      expect(session.id).toMatch(/^chat-/);
      expect(session.acpSessionId).toBe("acp-session-1");
      expect(session.model).toBe("gpt-4");
      expect(session.messages).toEqual([]);
    });

    it.each(["researcher", "planner", "reviewer", "general"] as ChatRole[])(
      "creates a session for role '%s'",
      async (role) => {
        const session = await manager.createSession(role);
        expect(session.role).toBe(role);
      },
    );

    it("connects the ACP client and sets agent mode", async () => {
      await manager.createSession("general");

      expect(AcpClient.prototype.connect).toHaveBeenCalledOnce();
      expect(AcpClient.prototype.createSession).toHaveBeenCalledWith({
        cwd: "/tmp/test-project",
      });
      expect(AcpClient.prototype.setMode).toHaveBeenCalledWith(
        "acp-session-1",
        "https://agentclientprotocol.com/protocol/session-modes#agent",
      );
    });

    it("sends a role-specific system prompt from .aiscrum/roles/", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "copilot-instructions.md", isDirectory: () => false, isFile: () => true } as unknown as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue("# Reviewer Agent\nCode Review Agent instructions");

      await manager.createSession("reviewer");

      const sendPromptCall = vi.mocked(AcpClient.prototype.sendPrompt).mock.calls[0];
      expect(sendPromptCall[0]).toBe("acp-session-1");
      expect(sendPromptCall[1]).toContain("Code Review Agent");
      expect(sendPromptCall[1]).toContain("Respond helpfully and concisely");
    });

    it("loads all .md files from role directory", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "copilot-instructions.md", isDirectory: () => false, isFile: () => true } as unknown as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue("# Refiner Agent Instructions\nCustom refiner context");

      await manager.createSession("refiner");

      const prompt = vi.mocked(AcpClient.prototype.sendPrompt).mock.calls[0][1] as string;
      expect(prompt).toContain("# Refiner Agent Instructions");
      expect(prompt).toContain("Custom refiner context");
    });

    it("throws when role folder does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(manager.createSession("planner")).rejects.toThrow("No role context found");
    });

    it("reuses the ACP client on second createSession call", async () => {
      await manager.createSession("general");
      await manager.createSession("reviewer");

      // connect() only called once (lazy initialization)
      expect(AcpClient.prototype.connect).toHaveBeenCalledOnce();
    });
  });

  describe("sendMessage", () => {
    it("sends a message and returns the assistant response", async () => {
      const session = await manager.createSession("general");

      const response = await manager.sendMessage(session.id, "What is TypeScript?");

      expect(response).toBe("Hello from assistant");
      expect(AcpClient.prototype.sendPrompt).toHaveBeenCalledWith(
        "acp-session-1",
        "What is TypeScript?",
        600_000,
      );
    });

    it("records user and assistant messages in the session", async () => {
      const session = await manager.createSession("general");
      await manager.sendMessage(session.id, "Hello");

      const updated = manager.getSession(session.id)!;
      expect(updated.messages).toHaveLength(2);
      expect(updated.messages[0]).toMatchObject({ role: "user", content: "Hello" });
      expect(updated.messages[1]).toMatchObject({ role: "assistant", content: "Hello from assistant" });
    });

    it("throws when session does not exist", async () => {
      await expect(manager.sendMessage("nonexistent", "hi")).rejects.toThrow(
        "Chat session nonexistent not found",
      );
    });

    it("uses custom timeoutMs from options", async () => {
      manager = new ChatManager({ projectPath: "/tmp/test", timeoutMs: 30_000 });
      const session = await manager.createSession("general");
      await manager.sendMessage(session.id, "test");

      // Second sendPrompt call (first is system prompt)
      const calls = vi.mocked(AcpClient.prototype.sendPrompt).mock.calls;
      const sendMsgCall = calls[calls.length - 1];
      expect(sendMsgCall[2]).toBe(30_000);
    });
  });

  describe("closeSession", () => {
    it("ends the ACP session and removes from tracking", async () => {
      const session = await manager.createSession("general");

      await manager.closeSession(session.id);

      expect(AcpClient.prototype.endSession).toHaveBeenCalledWith("acp-session-1");
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it("no-ops for an unknown session ID", async () => {
      await expect(manager.closeSession("nonexistent")).resolves.toBeUndefined();
      expect(AcpClient.prototype.endSession).not.toHaveBeenCalled();
    });
  });

  describe("getSession / listSessions", () => {
    it("returns undefined for unknown session", () => {
      expect(manager.getSession("nope")).toBeUndefined();
    });

    it("lists all active sessions", async () => {
      await manager.createSession("general");
      await manager.createSession("reviewer");

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.role)).toContain("general");
      expect(sessions.map((s) => s.role)).toContain("reviewer");
    });
  });

  describe("shutdown", () => {
    it("closes all sessions and disconnects the client", async () => {
      await manager.createSession("general");
      await manager.createSession("reviewer");

      await manager.shutdown();

      expect(AcpClient.prototype.endSession).toHaveBeenCalledTimes(2);
      expect(AcpClient.prototype.disconnect).toHaveBeenCalledOnce();
      expect(manager.listSessions()).toHaveLength(0);
    });

    it("handles shutdown when no sessions exist", async () => {
      // Force client creation by creating then closing a session
      await manager.createSession("general");
      const session = manager.listSessions()[0];
      await manager.closeSession(session.id);
      vi.clearAllMocks();

      await manager.shutdown();

      expect(AcpClient.prototype.endSession).not.toHaveBeenCalled();
      expect(AcpClient.prototype.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe("error handling", () => {
    it("propagates ACP createSession errors", async () => {
      vi.mocked(AcpClient.prototype.createSession).mockRejectedValueOnce(
        new Error("ACP connection lost"),
      );

      await expect(manager.createSession("general")).rejects.toThrow("ACP connection lost");
    });

    it("propagates ACP sendPrompt errors", async () => {
      const session = await manager.createSession("general");

      vi.mocked(AcpClient.prototype.sendPrompt).mockRejectedValueOnce(
        new Error("ACP timeout"),
      );

      await expect(manager.sendMessage(session.id, "test")).rejects.toThrow("ACP timeout");
    });

    it("propagates ACP connect errors", async () => {
      vi.mocked(AcpClient.prototype.connect).mockRejectedValueOnce(
        new Error("Failed to spawn copilot"),
      );

      // New manager so client is not yet connected
      const mgr = new ChatManager({ projectPath: "/tmp/test" });
      await expect(mgr.createSession("general")).rejects.toThrow("Failed to spawn copilot");
    });
  });

  describe("streaming callback", () => {
    it("relays stream chunks via onStreamChunk option", async () => {
      const chunks: { sessionId: string; text: string }[] = [];

      // Capture the onStreamChunk passed to AcpClient constructor
      vi.mocked(AcpClient).mockImplementationOnce((opts: { onStreamChunk?: (id: string, text: string) => void }) => {
        // Store the internal callback for later invocation
        const instance = {
          connect: vi.fn().mockResolvedValue(undefined),
          createSession: vi.fn().mockResolvedValue({
            sessionId: "acp-stream-1",
            currentModel: "gpt-4",
          }),
          setMode: vi.fn().mockResolvedValue(undefined),
          sendPrompt: vi.fn().mockImplementation(async () => {
            // Simulate streaming by calling the internal callback
            opts.onStreamChunk?.("acp-stream-1", "chunk1");
            opts.onStreamChunk?.("acp-stream-1", "chunk2");
            return { response: "chunk1chunk2", stopReason: "end" };
          }),
          endSession: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
        };
        return instance as unknown as AcpClient;
      });

      const mgr = new ChatManager({
        projectPath: "/tmp/test",
        onStreamChunk: (sessionId, text) => chunks.push({ sessionId, text }),
      });

      const session = await mgr.createSession("general");
      await mgr.sendMessage(session.id, "stream test");

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].text).toBe("chunk1");
      expect(chunks[1].text).toBe("chunk2");
      // The sessionId in the callback should be the chat ID, not the ACP session ID
      expect(chunks[0].sessionId).toBe(session.id);
    });
  });
});

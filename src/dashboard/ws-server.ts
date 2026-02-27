/**
 * Dashboard WebSocket Server
 *
 * HTTP server for static files + WebSocket for real-time sprint event streaming.
 * Bridges SprintEventBus events to connected browser clients.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import type { SprintEventBus, SprintEngineEvents } from "../tui/events.js";
import type { SprintState } from "../runner.js";
import { logger } from "../logger.js";
import { ChatManager, type ChatRole } from "./chat-manager.js";
import { loadSprintHistory } from "./sprint-history.js";
import { SprintIssueCache } from "./issue-cache.js";

const log = logger.child({ component: "ws-server" });

export interface IssueEntry {
  number: number;
  title: string;
  status: "planned" | "in-progress" | "done" | "failed";
}

/** Message sent from server to browser clients. */
export interface ServerMessage {
  type: "sprint:event" | "sprint:state" | "sprint:issues" | "session:list" | "session:output" | "chat:chunk" | "chat:done" | "chat:created" | "chat:error" | "pong";
  eventName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/** Message sent from browser client to server. */
export interface ClientMessage {
  type: "sprint:start" | "sprint:stop" | "sprint:switch" | "session:subscribe" | "session:unsubscribe" | "chat:create" | "chat:send" | "chat:close" | "ping";
  sprintNumber?: number;
  sessionId?: string;
  role?: string;
  message?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface DashboardServerOptions {
  port: number;
  host: string;
  eventBus: SprintEventBus;
  getState: () => SprintState;
  getIssues: () => IssueEntry[];
  onStart?: () => void;
  onSwitchSprint?: (sprintNumber: number) => void;
  /** Project root for loading sprint state files. */
  projectPath?: string;
  /** Currently active sprint number (the one being executed). */
  activeSprintNumber?: number;
}

export interface TrackedSession {
  sessionId: string;
  role: string;
  issueNumber?: number;
  model?: string;
  startedAt: number;
  endedAt?: number;
  output: string[];
}

export class DashboardWebServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private chatManager: ChatManager | null = null;
  private issueCache: SprintIssueCache | null = null;
  private repoUrl: string | null = null;
  private sessions = new Map<string, TrackedSession>();
  private sessionSubscribers = new Map<string, Set<WebSocket>>();
  private readonly options: DashboardServerOptions;
  private readonly publicDir: string;

  constructor(options: DashboardServerOptions) {
    this.options = options;
    this.publicDir = path.join(path.dirname(new URL(import.meta.url).pathname), "public");
  }

  async start(): Promise<void> {
    const { port, host } = this.options;

    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws) => {
      log.info("Dashboard client connected");

      // Send current state immediately on connect
      this.sendTo(ws, {
        type: "sprint:state",
        payload: this.options.getState(),
      });
      this.sendTo(ws, {
        type: "sprint:issues",
        payload: this.options.getIssues(),
      });
      // Send active session list
      if (this.sessions.size > 0) {
        const sessions = Array.from(this.sessions.values()).map(s => ({
          sessionId: s.sessionId,
          role: s.role,
          issueNumber: s.issueNumber,
          model: s.model,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          outputLength: s.output.length,
        }));
        this.sendTo(ws, { type: "session:list", payload: sessions });
      }

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientMessage;
          this.handleClientMessage(msg, ws);
        } catch {
          log.warn("Invalid WebSocket message from client");
        }
      });

      ws.on("close", () => {
        log.info("Dashboard client disconnected");
        // Clean up session subscriptions
        for (const subs of this.sessionSubscribers.values()) {
          subs.delete(ws);
        }
      });
    });

    this.bridgeEvents();

    // Initialize issue cache with preload + background refresh
    const activeNum = this.options.activeSprintNumber ?? 1;
    this.issueCache = new SprintIssueCache({
      maxSprint: activeNum,
      loadState: (n) => this.loadSprintState(n),
    });
    // Preload in background — don't block server start
    this.issueCache.preload().then(() => {
      this.issueCache!.startRefresh();
    }).catch((err) => {
      log.warn({ err }, "Issue cache preload failed");
    });

    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        log.info({ port, host }, "Dashboard server started");
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.issueCache) {
      this.issueCache.stop();
      this.issueCache = null;
    }
    if (this.chatManager) {
      await this.chatManager.shutdown();
      this.chatManager = null;
    }
    if (this.wss) {
      for (const ws of this.wss.clients) {
        ws.close();
      }
      this.wss.close();
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  private broadcast(msg: ServerMessage): void {
    if (!this.wss) return;
    const data = JSON.stringify(msg);
    for (const ws of this.wss.clients) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastSessionList(): void {
    const sessions = Array.from(this.sessions.values()).map(s => ({
      sessionId: s.sessionId,
      role: s.role,
      issueNumber: s.issueNumber,
      model: s.model,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      outputLength: s.output.length,
    }));
    this.broadcast({ type: "session:list", payload: sessions });
  }

  /** Subscribe to all SprintEventBus events and relay to WebSocket clients. */
  private bridgeEvents(): void {
    const bus = this.options.eventBus;
    const eventNames: (keyof SprintEngineEvents)[] = [
      "phase:change", "issue:start", "issue:progress", "issue:done", "issue:fail",
      "worker:output", "sprint:start", "sprint:complete", "sprint:error",
      "sprint:paused", "sprint:resumed", "log",
    ];

    for (const eventName of eventNames) {
      bus.onTyped(eventName, (payload) => {
        this.broadcast({
          type: "sprint:event",
          eventName,
          payload,
        });
      });
    }

    // Track ACP sessions for the session viewer
    bus.onTyped("session:start", (payload) => {
      this.sessions.set(payload.sessionId, {
        sessionId: payload.sessionId,
        role: payload.role,
        issueNumber: payload.issueNumber,
        model: payload.model,
        startedAt: Date.now(),
        output: [],
      });
      this.broadcastSessionList();
    });

    bus.onTyped("session:end", (payload) => {
      const session = this.sessions.get(payload.sessionId);
      if (session) {
        session.endedAt = Date.now();
        this.broadcastSessionList();
        // Clean up subscribers
        this.sessionSubscribers.delete(payload.sessionId);
      }
    });

    bus.onTyped("worker:output", (payload) => {
      const session = this.sessions.get(payload.sessionId);
      if (session) {
        session.output.push(payload.text);
        // Cap stored output to prevent memory bloat (keep last 500 chunks)
        if (session.output.length > 500) {
          session.output = session.output.slice(-400);
        }
      }
      // Send to subscribers of this session
      const subs = this.sessionSubscribers.get(payload.sessionId);
      if (subs) {
        const msg: ServerMessage = {
          type: "session:output",
          payload: { sessionId: payload.sessionId, text: payload.text },
        };
        for (const ws of subs) {
          this.sendTo(ws, msg);
        }
      }
    });
  }

  private handleClientMessage(msg: ClientMessage, ws: WebSocket): void {
    switch (msg.type) {
      case "sprint:start":
        log.info("Dashboard client requested sprint start");
        this.options.onStart?.();
        break;
      case "sprint:switch":
        if (msg.sprintNumber) {
          log.info({ sprintNumber: msg.sprintNumber }, "Dashboard client switched sprint");
          this.options.onSwitchSprint?.(msg.sprintNumber);
          // Re-send current state and issues to the requesting client
          this.sendTo(ws, {
            type: "sprint:state",
            payload: this.options.getState(),
          });
          this.sendTo(ws, {
            type: "sprint:issues",
            payload: this.options.getIssues(),
          });
        }
        break;
      case "chat:create":
        this.handleChatCreate(msg.role as ChatRole | undefined, ws);
        break;
      case "chat:send":
        if (msg.sessionId && msg.message) {
          this.handleChatSend(msg.sessionId, msg.message, ws);
        }
        break;
      case "chat:close":
        if (msg.sessionId) {
          this.handleChatClose(msg.sessionId);
        }
        break;
      case "session:subscribe":
        if (msg.sessionId) {
          let subs = this.sessionSubscribers.get(msg.sessionId);
          if (!subs) {
            subs = new Set();
            this.sessionSubscribers.set(msg.sessionId, subs);
          }
          subs.add(ws);
          // Send existing output history
          const session = this.sessions.get(msg.sessionId);
          if (session) {
            this.sendTo(ws, {
              type: "session:output",
              payload: { sessionId: msg.sessionId, text: session.output.join(""), isHistory: true },
            });
          }
        }
        break;
      case "session:unsubscribe":
        if (msg.sessionId) {
          this.sessionSubscribers.get(msg.sessionId)?.delete(ws);
        }
        break;
      case "ping":
        break;
    }
  }

  /** Lazy-initialize chat manager. */
  private getChatManager(): ChatManager {
    if (!this.chatManager) {
      this.chatManager = new ChatManager({
        projectPath: this.options.projectPath ?? process.cwd(),
        onStreamChunk: (chatId, text) => {
          this.broadcast({
            type: "chat:chunk",
            payload: { sessionId: chatId, text },
          });
        },
      });
    }
    return this.chatManager;
  }

  private async handleChatCreate(role: ChatRole | undefined, ws: WebSocket): Promise<void> {
    const validRole = role ?? "general";
    try {
      const session = await this.getChatManager().createSession(validRole);
      this.sendTo(ws, {
        type: "chat:created",
        payload: {
          sessionId: session.id,
          role: session.role,
          model: session.model,
        },
      });
      log.info({ chatId: session.id, role: validRole }, "Chat session created via dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, role: validRole }, "Failed to create chat session");
      this.sendTo(ws, {
        type: "chat:error",
        payload: { error: `Failed to create session: ${msg}` },
      });
    }
  }

  private async handleChatSend(sessionId: string, message: string, ws: WebSocket): Promise<void> {
    try {
      const response = await this.getChatManager().sendMessage(sessionId, message);
      this.sendTo(ws, {
        type: "chat:done",
        payload: { sessionId, response },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, sessionId }, "Chat message failed");
      this.sendTo(ws, {
        type: "chat:error",
        payload: { sessionId, error: msg },
      });
    }
  }

  private async handleChatClose(sessionId: string): Promise<void> {
    try {
      await this.getChatManager().closeSession(sessionId);
    } catch (err: unknown) {
      log.warn({ err, sessionId }, "Failed to close chat session");
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // API routes
    if (url.pathname.startsWith("/api/")) {
      this.handleApi(url.pathname, res);
      return;
    }

    let filePath = path.join(this.publicDir, url.pathname === "/" ? "index.html" : url.pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(this.publicDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(this.publicDir, "index.html");
    }

    try {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  /** Handle REST API requests. */
  private handleApi(pathname: string, res: http.ServerResponse): void {
    res.setHeader("Content-Type", "application/json");

    if (pathname === "/api/repo") {
      this.handleRepoInfo(res);
      return;
    }

    if (pathname === "/api/sessions") {
      const sessions = Array.from(this.sessions.values()).map(s => ({
        sessionId: s.sessionId,
        role: s.role,
        issueNumber: s.issueNumber,
        model: s.model,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        outputLength: s.output.length,
      }));
      res.writeHead(200);
      res.end(JSON.stringify(sessions));
      return;
    }

    if (pathname === "/api/sprints") {
      const sprints = this.listSprints();
      res.writeHead(200);
      res.end(JSON.stringify(sprints));
      return;
    }

    if (pathname === "/api/sprints/history") {
      const projectPath = this.options.projectPath ?? process.cwd();
      const velocityPath = path.join(projectPath, "docs", "sprints", "velocity.md");
      const history = loadSprintHistory(velocityPath);
      res.writeHead(200);
      res.end(JSON.stringify(history));
      return;
    }

    // /api/sprints/:number/issues — fetch issues from GitHub milestone
    const issuesMatch = pathname.match(/^\/api\/sprints\/(\d+)\/issues$/);
    if (issuesMatch) {
      const num = parseInt(issuesMatch[1], 10);
      this.handleSprintIssues(num, res);
      return;
    }

    // /api/sprints/:number/state
    const stateMatch = pathname.match(/^\/api\/sprints\/(\d+)\/state$/);
    if (stateMatch) {
      const num = parseInt(stateMatch[1], 10);
      const sprintState = this.loadSprintState(num);
      if (sprintState) {
        res.writeHead(200);
        res.end(JSON.stringify(sprintState));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ sprintNumber: num, phase: "init", startedAt: null }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /** Fetch issues for a sprint — serves from cache instantly. */
  private handleSprintIssues(sprintNumber: number, res: http.ServerResponse): void {
    // Active sprint: always return live tracked issues
    if (sprintNumber === this.options.activeSprintNumber) {
      const issues = this.options.getIssues();
      // Also update cache so switching back is instant
      if (this.issueCache) {
        this.issueCache.set(sprintNumber, issues);
      }
      res.writeHead(200);
      res.end(JSON.stringify(issues));
      return;
    }

    // All other sprints: serve from cache (preloaded on start)
    const cached = this.issueCache?.get(sprintNumber) ?? [];
    res.writeHead(200);
    res.end(JSON.stringify(cached));
  }

  /** Return repo info (URL cached after first detection). */
  private async handleRepoInfo(res: http.ServerResponse): Promise<void> {
    if (!this.repoUrl) {
      this.repoUrl = await this.detectRepoUrl();
    }
    res.writeHead(200);
    res.end(JSON.stringify({ url: this.repoUrl }));
  }

  /** Detect GitHub repo URL from git remote. */
  private async detectRepoUrl(): Promise<string | null> {
    const execFileAsync = promisify(execFile);
    try {
      const cwd = this.options.projectPath ?? process.cwd();
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
      const raw = stdout.trim();
      // Convert SSH URLs: git@github.com:owner/repo.git → https://github.com/owner/repo
      if (raw.startsWith("git@")) {
        const match = raw.match(/git@([^:]+):(.+?)(?:\.git)?$/);
        if (match) return `https://${match[1]}/${match[2]}`;
      }
      // HTTPS URLs: strip .git suffix
      return raw.replace(/\.git$/, "");
    } catch {
      log.debug("Could not detect repo URL from git remote");
      return null;
    }
  }

  /** List available sprints by scanning state files, log files, and filling gaps. */
  private listSprints(): { sprintNumber: number; phase: string; isActive: boolean }[] {
    const projectPath = this.options.projectPath ?? process.cwd();
    const sprintsDir = path.join(projectPath, "docs", "sprints");
    const sprintMap = new Map<number, { phase: string; isActive: boolean }>();

    // Scan for state files (sprint-N-state.json)
    try {
      const files = fs.readdirSync(sprintsDir);
      for (const file of files) {
        // Match state files
        const stateMatch = file.match(/^sprint-(\d+)-state\.json$/);
        if (stateMatch) {
          const num = parseInt(stateMatch[1], 10);
          try {
            const raw = fs.readFileSync(path.join(sprintsDir, file), "utf-8");
            const state = JSON.parse(raw) as { phase?: string };
            sprintMap.set(num, {
              phase: state.phase ?? "unknown",
              isActive: num === this.options.activeSprintNumber,
            });
          } catch {
            sprintMap.set(num, { phase: "unknown", isActive: false });
          }
        }

        // Match log files (sprint-N-log.md) — sprints that ran but may not have state files
        const logMatch = file.match(/^sprint-(\d+)-log\.md$/);
        if (logMatch) {
          const num = parseInt(logMatch[1], 10);
          if (!sprintMap.has(num)) {
            sprintMap.set(num, { phase: "complete", isActive: false });
          }
        }
      }
    } catch {
      // No sprints dir yet
    }

    // Ensure active sprint is in the list
    const activeNum = this.options.activeSprintNumber;
    if (activeNum && !sprintMap.has(activeNum)) {
      const currentState = this.options.getState();
      sprintMap.set(activeNum, { phase: currentState.phase, isActive: true });
    }

    // Fill gaps: if we have sprint 3, ensure 1 and 2 exist too
    if (sprintMap.size > 0) {
      const maxSprint = Math.max(...sprintMap.keys());
      for (let i = 1; i < maxSprint; i++) {
        if (!sprintMap.has(i)) {
          sprintMap.set(i, { phase: "complete", isActive: false });
        }
      }
    }

    return Array.from(sprintMap.entries())
      .map(([num, data]) => ({ sprintNumber: num, ...data }))
      .sort((a, b) => a.sprintNumber - b.sprintNumber);
  }

  /** Load sprint state from disk. */
  private loadSprintState(sprintNumber: number): SprintState | null {
    // If this is the active sprint, return live state
    if (sprintNumber === this.options.activeSprintNumber) {
      return this.options.getState();
    }

    const projectPath = this.options.projectPath ?? process.cwd();
    const filePath = path.join(projectPath, "docs", "sprints", `sprint-${sprintNumber}-state.json`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(raw) as SprintState;
      state.startedAt = new Date(state.startedAt);
      return state;
    } catch {
      return null;
    }
  }
}

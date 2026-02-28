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
import type { SprintEventBus, SprintEngineEvents } from "../events.js";
import type { SprintState } from "../runner.js";
import { logger } from "../logger.js";
import { ChatManager, type ChatRole } from "./chat-manager.js";
import { sessionController } from "./session-control.js";
import { loadSprintHistory } from "./sprint-history.js";
import { SprintIssueCache } from "./issue-cache.js";
import { listSprintMilestones } from "../github/milestones.js";

const log = logger.child({ component: "ws-server" });

export interface IssueEntry {
  number: number;
  title: string;
  status: "planned" | "in-progress" | "done" | "failed";
}

/** Message sent from server to browser clients. */
export interface ServerMessage {
  type: "sprint:event" | "sprint:state" | "sprint:issues" | "sprint:switched" | "session:list" | "session:output" | "session:status" | "chat:chunk" | "chat:done" | "chat:created" | "chat:error" | "pong";
  eventName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/** Message sent from browser client to server. */
export interface ClientMessage {
  type: "sprint:start" | "sprint:stop" | "sprint:pause" | "sprint:resume" | "sprint:switch" | "mode:set" | "session:subscribe" | "session:unsubscribe" | "session:send-message" | "session:stop" | "chat:create" | "chat:send" | "chat:close" | "ping";
  sprintNumber?: number;
  sessionId?: string;
  role?: string;
  message?: string;
  mode?: string;
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
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSwitchSprint?: (sprintNumber: number) => void | Promise<void>;
  onModeChange?: (mode: "autonomous" | "hitl") => void;
  /** Project root for loading sprint state files. */
  projectPath?: string;
  /** Currently active sprint number (the one being executed). */
  activeSprintNumber?: number;
  /** Sprint prefix for milestone titles (default: "Sprint"). */
  sprintPrefix?: string;
  /** Sprint slug for file naming (default: "sprint"). */
  sprintSlug?: string;
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

/** Max events to buffer for replay on sprint switch. */
const EVENT_BUFFER_MAX = 200;

interface BufferedEvent {
  eventName: string;
  payload: unknown;
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
  private eventBuffer: BufferedEvent[] = [];
  private knownMilestones: { sprintNumber: number; title: string; state: string }[] = [];

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
      // Send active sprint info so client knows which sprint is running
      this.sendTo(ws, {
        type: "sprint:switched",
        payload: { sprintNumber: this.options.activeSprintNumber, activeSprintNumber: this.options.activeSprintNumber },
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

      // Replay buffered events so new clients see activity history
      if (this.eventBuffer.length > 0) {
        for (const buffered of this.eventBuffer) {
          this.sendTo(ws, {
            type: "sprint:event",
            eventName: buffered.eventName,
            payload: buffered.payload,
          });
        }
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

    // Discover sprints from GitHub milestones (async, non-blocking)
    const prefix = this.options.sprintPrefix ?? "Sprint";
    const activeNum = this.options.activeSprintNumber ?? 1;
    listSprintMilestones(prefix).then((milestones) => {
      this.knownMilestones = milestones;
      // Determine max sprint from both milestones and active sprint
      const maxFromMilestones = milestones.length > 0
        ? Math.max(...milestones.map((m) => m.sprintNumber))
        : 0;
      const maxSprint = Math.max(activeNum, maxFromMilestones);
      log.info({ milestones: milestones.length, maxSprint }, "Sprint milestones discovered");

      // Initialize issue cache with full range
      this.issueCache = new SprintIssueCache({
        maxSprint,
        loadState: (n) => this.loadSprintState(n),
        sprintPrefix: prefix,
      });
      this.issueCache.preload().then(() => {
        this.issueCache!.startRefresh();
      }).catch((err) => {
        log.warn({ err }, "Issue cache preload failed");
      });
    }).catch((err) => {
      log.warn({ err }, "Milestone discovery failed, falling back to active sprint only");
      this.issueCache = new SprintIssueCache({
        maxSprint: activeNum,
        loadState: (n) => this.loadSprintState(n),
        sprintPrefix: prefix,
      });
      this.issueCache.preload().then(() => {
        this.issueCache!.startRefresh();
      }).catch((e) => {
        log.warn({ err: e }, "Issue cache preload failed");
      });
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
    // Remove all event bus listeners to prevent accumulation on restart
    const bus = this.options.eventBus;
    bus.removeAllListeners();

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
      if (ws.readyState === 1 && ws.bufferedAmount < 1_048_576) {
        ws.send(data);
      }
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1 && ws.bufferedAmount < 1_048_576) {
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
      "worker:output", "sprint:start", "sprint:planned", "sprint:complete", "sprint:error",
      "sprint:paused", "sprint:resumed", "log",
    ];

    for (const eventName of eventNames) {
      bus.onTyped(eventName, (payload) => {
        const msg = { type: "sprint:event" as const, eventName, payload };
        this.broadcast(msg);
        // Buffer for replay on sprint switch
        this.eventBuffer.push({ eventName, payload });
        if (this.eventBuffer.length > EVENT_BUFFER_MAX) {
          this.eventBuffer.shift();
        }
      });
    }

    // Push updated issue list when planning completes
    bus.onTyped("sprint:planned", () => {
      // Small delay to let index.ts update currentIssues first
      setTimeout(() => {
        this.broadcast({ type: "sprint:issues", payload: this.options.getIssues() });
        // Also update the issue cache
        const sprintNum = this.options.activeSprintNumber ?? 1;
        if (this.issueCache) {
          this.issueCache.set(sprintNum, this.options.getIssues().map((i) => ({
            number: i.number,
            title: i.title,
            status: i.status as "planned" | "in-progress" | "done" | "failed",
          })));
        }
      }, 500);
    });

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
          const sprintNum = msg.sprintNumber;
          // Await async callback before re-sending state
          Promise.resolve(this.options.onSwitchSprint?.(sprintNum))
            .then(() => {
              // Load state for the requested sprint
              const state = this.loadSprintState(sprintNum);
              this.sendTo(ws, {
                type: "sprint:state",
                payload: state ?? this.options.getState(),
              });
              this.sendTo(ws, {
                type: "sprint:issues",
                payload: this.options.getIssues(),
              });
              this.sendTo(ws, {
                type: "sprint:switched",
                payload: { sprintNumber: sprintNum, activeSprintNumber: this.options.activeSprintNumber },
              });
            })
            .catch((err: unknown) => {
              log.warn({ err }, "Sprint switch failed");
            });
        }
        break;
      case "sprint:pause":
        log.info("Dashboard client requested sprint pause");
        this.options.onPause?.();
        break;
      case "sprint:resume":
        log.info("Dashboard client requested sprint resume");
        this.options.onResume?.();
        break;
      case "sprint:stop":
        log.info("Dashboard client requested sprint stop");
        this.options.onStop?.();
        break;
      case "mode:set":
        if (msg.mode === "autonomous" || msg.mode === "hitl") {
          log.info({ mode: msg.mode }, "Dashboard client changed execution mode");
          this.options.onModeChange?.(msg.mode);
          this.broadcast({ type: "sprint:event", eventName: "mode:changed", payload: { mode: msg.mode } });
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
      case "session:send-message":
        if (msg.sessionId && msg.message) {
          const targetSession = this.sessions.get(msg.sessionId);
          if (targetSession && !targetSession.endedAt) {
            sessionController.enqueue(msg.sessionId, msg.message);
            this.sendTo(ws, {
              type: "session:status",
              payload: { sessionId: msg.sessionId, action: "message-queued", message: msg.message },
            });
            log.info({ sessionId: msg.sessionId }, "user message queued for session");
          } else {
            this.sendTo(ws, {
              type: "session:status",
              payload: { sessionId: msg.sessionId, action: "error", error: "Session not active" },
            });
          }
        }
        break;
      case "session:stop":
        if (msg.sessionId) {
          const stopSession = this.sessions.get(msg.sessionId);
          if (stopSession && !stopSession.endedAt) {
            sessionController.requestStop(msg.sessionId);
            this.sendTo(ws, {
              type: "session:status",
              payload: { sessionId: msg.sessionId, action: "stop-requested" },
            });
            log.warn({ sessionId: msg.sessionId }, "user requested session stop");
          }
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

    // /api/backlog — refined issues not in any open sprint milestone
    if (pathname === "/api/backlog") {
      this.handleBacklogRequest(res);
      return;
    }

    // /api/ideas — type:idea issues awaiting refinement
    if (pathname === "/api/ideas") {
      this.handleIdeasRequest(res);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /** Fetch issues for a sprint — serves from cache, loads on demand if needed. */
  private handleSprintIssues(sprintNumber: number, res: http.ServerResponse): void {
    // Active sprint: always return live tracked issues
    if (sprintNumber === this.options.activeSprintNumber) {
      const issues = this.options.getIssues();
      if (this.issueCache) {
        this.issueCache.set(sprintNumber, issues);
      }
      res.writeHead(200);
      res.end(JSON.stringify(issues));
      return;
    }

    // Check cache — if hit, serve immediately
    if (this.issueCache?.has(sprintNumber)) {
      const cached = this.issueCache.get(sprintNumber);
      res.writeHead(200);
      res.end(JSON.stringify(cached));
      return;
    }

    // Cache miss — load on demand from GitHub
    const prefix = this.options.sprintPrefix ?? "Sprint";
    import("../github/issues.js").then(async ({ listIssues }) => {
      try {
        const ghIssues = await listIssues({
          milestone: `${prefix} ${sprintNumber}`,
          state: "all",
        });
        const mapped = ghIssues.map((i) => ({
          number: i.number,
          title: i.title,
          status: (i.state === "closed" ? "done" : "planned") as "planned" | "done",
        }));
        this.issueCache?.set(sprintNumber, mapped);
        res.writeHead(200);
        res.end(JSON.stringify(mapped));
      } catch {
        res.writeHead(200);
        res.end(JSON.stringify([]));
      }
    }).catch((err) => {
      log.debug({ err: String(err) }, "non-critical dashboard operation failed");
      res.writeHead(200);
      res.end(JSON.stringify([]));
    });
  }

  /** Return backlog issues (refined, not assigned to an open sprint). */
  private handleBacklogRequest(res: http.ServerResponse): void {
    import("../github/issues.js").then(async ({ listIssues }) => {
      try {
        const ghIssues = await listIssues({ state: "open", labels: ["status:refined"] });
        const backlog = ghIssues.map((i) => ({
          number: i.number,
          title: i.title,
          labels: i.labels.map((l) => l.name),
        }));
        res.writeHead(200);
        res.end(JSON.stringify(backlog));
      } catch {
        res.writeHead(200);
        res.end(JSON.stringify([]));
      }
    }).catch(() => {
      res.writeHead(200);
      res.end(JSON.stringify([]));
    });
  }

  /** Return idea issues (type:idea, awaiting refinement). */
  private handleIdeasRequest(res: http.ServerResponse): void {
    import("../github/issues.js").then(async ({ listIssues }) => {
      try {
        const ghIssues = await listIssues({ state: "open", labels: ["type:idea"] });
        const ideas = ghIssues.map((i) => ({
          number: i.number,
          title: i.title,
          body: (i.body ?? "").slice(0, 200),
        }));
        res.writeHead(200);
        res.end(JSON.stringify(ideas));
      } catch {
        res.writeHead(200);
        res.end(JSON.stringify([]));
      }
    }).catch(() => {
      res.writeHead(200);
      res.end(JSON.stringify([]));
    });
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
    const slug = this.options.sprintSlug ?? "sprint";
    const stateRegex = new RegExp(`^${slug}-(\\d+)-state\\.json$`);
    const logRegex = new RegExp(`^${slug}-(\\d+)-log\\.md$`);

    // Scan for state files ({slug}-N-state.json)
    try {
      const files = fs.readdirSync(sprintsDir);
      for (const file of files) {
        // Match state files
        const stateMatch = file.match(stateRegex);
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

        // Match log files ({slug}-N-log.md) — sprints that ran but may not have state files
        const logMatch = file.match(logRegex);
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

    // Include sprints discovered from GitHub milestones
    for (const ms of this.knownMilestones) {
      if (!sprintMap.has(ms.sprintNumber)) {
        sprintMap.set(ms.sprintNumber, {
          phase: ms.state === "closed" ? "complete" : "init",
          isActive: ms.sprintNumber === activeNum,
        });
      }
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
    const slug = this.options.sprintSlug ?? "sprint";
    const filePath = path.join(projectPath, "docs", "sprints", `${slug}-${sprintNumber}-state.json`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(raw) as SprintState;
      state.startedAt = new Date(state.startedAt);
      return state;
    } catch {
      // No state file — check for log file to infer completed sprint
      const logPath = path.join(projectPath, "docs", "sprints", `${slug}-${sprintNumber}-log.md`);
      try {
        if (fs.existsSync(logPath)) {
          return {
            version: "1",
            sprintNumber,
            phase: "complete",
            startedAt: new Date(),
          } as SprintState;
        }
      } catch {
        // ignore
      }
      return null;
    }
  }
}

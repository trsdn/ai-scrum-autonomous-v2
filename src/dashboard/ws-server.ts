/**
 * Dashboard WebSocket Server
 *
 * HTTP server for static files + WebSocket for real-time sprint event streaming.
 * Bridges SprintEventBus events to connected browser clients.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { SprintEventBus, SprintEngineEvents } from "../tui/events.js";
import type { SprintState } from "../runner.js";
import { logger } from "../logger.js";

const log = logger.child({ component: "ws-server" });

export interface IssueEntry {
  number: number;
  title: string;
  status: "planned" | "in-progress" | "done" | "failed";
}

/** Message sent from server to browser clients. */
export interface ServerMessage {
  type: "sprint:event" | "sprint:state" | "sprint:issues" | "pong";
  eventName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/** Message sent from browser client to server. */
export interface ClientMessage {
  type: "sprint:start" | "sprint:stop" | "sprint:switch" | "ping";
  sprintNumber?: number;
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

export class DashboardWebServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly options: DashboardServerOptions;
  private readonly publicDir: string;

  constructor(options: DashboardServerOptions) {
    this.options = options;
    // Resolve public dir relative to compiled JS location
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

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientMessage;
          this.handleClientMessage(msg);
        } catch {
          log.warn("Invalid WebSocket message from client");
        }
      });

      ws.on("close", () => log.info("Dashboard client disconnected"));
    });

    this.bridgeEvents();

    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        log.info({ port, host }, "Dashboard server started");
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
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
  }

  private handleClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case "sprint:start":
        log.info("Dashboard client requested sprint start");
        this.options.onStart?.();
        break;
      case "sprint:switch":
        if (msg.sprintNumber) {
          log.info({ sprintNumber: msg.sprintNumber }, "Dashboard client switched sprint");
          this.options.onSwitchSprint?.(msg.sprintNumber);
        }
        break;
      case "ping":
        break;
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

    if (pathname === "/api/sprints") {
      // List available sprints from state files
      const sprints = this.listSprints();
      res.writeHead(200);
      res.end(JSON.stringify(sprints));
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

  /** List available sprints by scanning state files and milestones. */
  private listSprints(): { sprintNumber: number; phase: string; isActive: boolean }[] {
    const projectPath = this.options.projectPath ?? process.cwd();
    const sprintsDir = path.join(projectPath, "docs", "sprints");
    const sprints: { sprintNumber: number; phase: string; isActive: boolean }[] = [];

    try {
      const files = fs.readdirSync(sprintsDir);
      for (const file of files) {
        const match = file.match(/^sprint-(\d+)-state\.json$/);
        if (match) {
          const num = parseInt(match[1], 10);
          try {
            const raw = fs.readFileSync(path.join(sprintsDir, file), "utf-8");
            const state = JSON.parse(raw) as { phase?: string };
            sprints.push({
              sprintNumber: num,
              phase: state.phase ?? "unknown",
              isActive: num === this.options.activeSprintNumber,
            });
          } catch {
            sprints.push({ sprintNumber: num, phase: "unknown", isActive: false });
          }
        }
      }
    } catch {
      // No sprints dir yet
    }

    // Ensure active sprint is in the list
    const activeNum = this.options.activeSprintNumber;
    if (activeNum && !sprints.some((s) => s.sprintNumber === activeNum)) {
      const currentState = this.options.getState();
      sprints.push({
        sprintNumber: activeNum,
        phase: currentState.phase,
        isActive: true,
      });
    }

    return sprints.sort((a, b) => a.sprintNumber - b.sprintNumber);
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

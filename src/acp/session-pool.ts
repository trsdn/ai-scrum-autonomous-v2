import { type AcpClient } from "./client.js";
import { type McpServerConfig } from "../types.js";
import { logger as defaultLogger, type Logger } from "../logger.js";

export interface PooledSession {
  sessionId: string;
  createdAt: number;
}

export interface CreateSessionOptions {
  cwd: string;
  mcpServers?: McpServerConfig[];
}

export class SessionPool {
  private readonly client: AcpClient;
  private readonly maxConcurrency: number;
  readonly sessionTimeoutMs: number;
  private readonly log: Logger;
  private readonly active = new Map<string, PooledSession>();
  private readonly waitQueue: Array<() => void> = [];

  constructor(
    client: AcpClient,
    maxConcurrency: number,
    sessionTimeoutMs: number,
  ) {
    this.client = client;
    this.maxConcurrency = maxConcurrency;
    this.sessionTimeoutMs = sessionTimeoutMs;
    this.log = defaultLogger.child({ component: "session-pool" });
  }

  async acquire(options: CreateSessionOptions): Promise<PooledSession> {
    while (this.active.size >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }

    let sessionId: string;
    try {
      sessionId = await this.client.createSession(
        options as Parameters<AcpClient["createSession"]>[0],
      );
    } catch (err) {
      // Wake next waiter so pool doesn't deadlock
      const next = this.waitQueue.shift();
      if (next) next();
      throw err;
    }
    const pooled: PooledSession = { sessionId, createdAt: Date.now() };
    this.active.set(sessionId, pooled);

    this.log.info(
      { sessionId, active: this.active.size, max: this.maxConcurrency },
      "session acquired",
    );

    return pooled;
  }

  async release(sessionId: string): Promise<void> {
    const session = this.active.get(sessionId);
    if (!session) {
      this.log.warn({ sessionId }, "attempted to release unknown session");
      return;
    }

    await this.client.endSession(sessionId);
    this.active.delete(sessionId);

    this.log.info(
      { sessionId, active: this.active.size },
      "session released",
    );

    const next = this.waitQueue.shift();
    if (next) next();
  }

  async executeInSession<T>(
    options: CreateSessionOptions,
    fn: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    const { sessionId } = await this.acquire(options);
    try {
      return await fn(sessionId);
    } finally {
      await this.release(sessionId);
    }
  }

  getStats(): { active: number; available: number; total: number } {
    return {
      active: this.active.size,
      available: this.maxConcurrency - this.active.size,
      total: this.maxConcurrency,
    };
  }

  async drainAll(): Promise<void> {
    this.log.info({ count: this.active.size }, "draining all sessions");
    const sessionIds = [...this.active.keys()];
    await Promise.all(sessionIds.map((id) => this.release(id)));
  }
}

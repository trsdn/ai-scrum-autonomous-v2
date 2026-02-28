import { logger } from "../logger.js";

export interface SessionMessage {
  type: "user-message" | "stop";
  content?: string;
  timestamp: Date;
}

/**
 * Per-session message queue for interactive dashboard control.
 * The dashboard sends messages, execution picks them up between prompts.
 */
export class SessionController {
  private queues = new Map<string, SessionMessage[]>();
  private stopSignals = new Set<string>();
  private log = logger.child({ module: "session-control" });

  /** Queue a user message for delivery to a running ACP session. */
  enqueue(sessionId: string, message: string): void {
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }
    this.queues.get(sessionId)!.push({
      type: "user-message",
      content: message,
      timestamp: new Date(),
    });
    this.log.info({ sessionId, queueSize: this.queues.get(sessionId)!.length }, "message queued");
  }

  /** Drain all pending messages for a session. Returns empty array if none. */
  drain(sessionId: string): SessionMessage[] {
    const messages = this.queues.get(sessionId) ?? [];
    this.queues.delete(sessionId);
    return messages;
  }

  /** Check if there are pending messages for a session. */
  hasPending(sessionId: string): boolean {
    return (this.queues.get(sessionId)?.length ?? 0) > 0;
  }

  /** Signal a session to stop. */
  requestStop(sessionId: string): void {
    this.stopSignals.add(sessionId);
    this.log.warn({ sessionId }, "stop requested");
  }

  /** Check and clear stop signal. Returns true if session should stop. */
  shouldStop(sessionId: string): boolean {
    if (this.stopSignals.has(sessionId)) {
      this.stopSignals.delete(sessionId);
      return true;
    }
    return false;
  }

  /** Clean up a session's queue and signals. */
  cleanup(sessionId: string): void {
    this.queues.delete(sessionId);
    this.stopSignals.delete(sessionId);
  }

  /** Get list of sessions with pending messages. */
  getActiveSessions(): string[] {
    return [...this.queues.keys()].filter(id => this.hasPending(id));
  }
}

// Singleton for cross-module access
export const sessionController = new SessionController();

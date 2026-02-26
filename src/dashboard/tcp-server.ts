/**
 * Dashboard TCP Server — Phase 5 (Dashboard)
 *
 * ACP TCP mode — persistent server that accepts dashboard connections
 * and broadcasts real-time sprint events via WebSocket.
 */

/** Event types broadcast to connected dashboard clients. */
export interface DashboardEvent {
  type:
    | "worker_update"
    | "sprint_progress"
    | "quality_gate"
    | "escalation";
  data: Record<string, unknown>;
  timestamp: Date;
}

/** A persistent server that streams events to dashboard clients. */
export interface DashboardServer {
  /** Start listening on the given port. */
  start(port: number): Promise<void>;
  /** Gracefully shut down the server. */
  stop(): Promise<void>;
  /** Push an event to all connected clients. */
  broadcastUpdate(event: DashboardEvent): void;
}

/**
 * Create a new dashboard server instance.
 *
 * @returns A {@link DashboardServer} ready to be started.
 * @throws Error — always, until Phase 5 implementation is complete.
 */
export function createDashboardServer(): DashboardServer {
  // TODO: Phase 5 — implement WebSocket server for real-time dashboard updates
  //
  // Planned approach:
  //   1. Use `ws` (or native Node WebSocket in Node 22+) for connections
  //   2. Accept connections on configurable port (default 9100)
  //   3. Maintain client set; broadcast JSON-serialised DashboardEvents
  //   4. Support graceful shutdown with client disconnect

  throw new Error("Dashboard server not yet implemented (Phase 5)");
}

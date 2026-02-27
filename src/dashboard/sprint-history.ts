// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
/**
 * Sprint History — Dashboard
 *
 * Loads historical sprint data from velocity.md for dashboard display.
 */

import { readVelocity } from "../documentation/velocity.js";
import type { SprintMetrics } from "../types.js";

/** A single sprint's historical record for visualization. */
export interface SprintHistoryEntry {
  sprintNumber: number;
  date: string;
  metrics: SprintMetrics;
  improvements: string[];
}

/**
 * Load historical sprint data for dashboard display.
 * Parses velocity.md into structured entries.
 */
export function loadSprintHistory(velocityPath?: string): SprintHistoryEntry[] {
  const entries = readVelocity(velocityPath);

  return entries.map((e) => ({
    sprintNumber: e.sprint,
    date: e.date,
    metrics: {
      planned: e.planned,
      completed: e.done,
      failed: e.carry,
      pointsPlanned: e.planned,
      pointsCompleted: e.done,
      velocity: e.issuesPerHr,
      avgDuration: e.hours > 0 && e.done > 0 ? (e.hours / e.done) * 60 : 0,
      firstPassRate: e.planned > 0 ? e.done / e.planned : 0,
      driftIncidents: 0,
    },
    improvements: [],
  }));
}

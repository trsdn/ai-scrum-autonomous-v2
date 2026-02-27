import * as fs from "node:fs";
import * as path from "node:path";
import type { SprintConfig } from "./types.js";
import type { SprintState } from "./runner.js";

// Re-export types needed by consumers
export type { SprintState };

export const STATE_VERSION = "1";

export function getStatePath(config: SprintConfig): string {
  return path.join(
    config.projectPath,
    "docs",
    "sprints",
    `${config.sprintSlug}-${config.sprintNumber}-state.json`,
  );
}

export function saveState(state: SprintState, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  const data = JSON.stringify({ ...state, version: STATE_VERSION }, null, 2);
  fs.writeFileSync(tmpPath, data, "utf-8");
  const fd = fs.openSync(tmpPath, "r");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpPath, filePath);
}

export function loadState(filePath: string): SprintState {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as SprintState;
  if (parsed.version && parsed.version !== STATE_VERSION) {
    throw new Error(
      `Incompatible sprint state version: got '${parsed.version}', expected '${STATE_VERSION}'. Delete the state file and restart.`,
    );
  }
  parsed.startedAt = new Date(parsed.startedAt);
  return parsed;
}

// --- Lock file ---

export function acquireLock(config: SprintConfig): void {
  const lockPath = getStatePath(config) + ".lock";
  const pid = process.pid;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    // Try exclusive create — fails if file exists
    fs.writeFileSync(lockPath, String(pid), { flag: "wx" });
  } catch {
    // Check if the holding process is alive
    let existingPid: number | null = null;
    try {
      existingPid = parseInt(fs.readFileSync(lockPath, "utf-8"), 10);
      process.kill(existingPid, 0); // Check if alive — throws if not
      throw new Error(
        `Sprint ${config.sprintNumber} is already running (PID ${existingPid}). Lock: ${lockPath}`,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("already running")) throw e;
      // Stale lock — process is dead, take over
      fs.writeFileSync(lockPath, String(pid));
    }
  }
}

export function releaseLock(config: SprintConfig): void {
  const lockPath = getStatePath(config) + ".lock";
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}

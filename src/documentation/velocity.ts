import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

const DEFAULT_FILE_PATH = "docs/sprints/velocity.md";

export interface VelocityEntry {
  sprint: number;
  date: string;
  goal: string;
  planned: number;
  done: number;
  carry: number;
  hours: number;
  issuesPerHr: number;
  notes: string;
}

const HEADER = [
  "# Velocity Tracker",
  "",
  "| Sprint | Date | Goal | Planned | Done | Carry | Hours | Issues/Hr | Notes |",
  "|--------|------|------|---------|------|-------|-------|-----------|-------|",
  "",
].join("\n");

function formatRow(e: VelocityEntry): string {
  return `| ${e.sprint} | ${e.date} | ${e.goal} | ${e.planned} | ${e.done} | ${e.carry} | ${e.hours} | ${e.issuesPerHr} | ${e.notes} |`;
}

export function readVelocity(filePath: string = DEFAULT_FILE_PATH): VelocityEntry[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.startsWith("| "));
  // Skip the header row (separator already filtered by startsWith("| "))
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const cols = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    return {
      sprint: Number(cols[0]),
      date: cols[1] ?? "",
      goal: cols[2] ?? "",
      planned: Number(cols[3]),
      done: Number(cols[4]),
      carry: Number(cols[5]),
      hours: Number(cols[6]),
      issuesPerHr: Number(cols[7]),
      notes: cols[8] ?? "",
    };
  });
}

export function appendVelocity(
  entry: VelocityEntry,
  filePath: string = DEFAULT_FILE_PATH,
): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, HEADER + formatRow(entry) + "\n", "utf-8");
      return;
    }

    fs.appendFileSync(filePath, formatRow(entry) + "\n", "utf-8");
  } catch (err: unknown) {
    logger.warn({ err, filePath }, "Failed to write velocity data — continuing");
  }
}

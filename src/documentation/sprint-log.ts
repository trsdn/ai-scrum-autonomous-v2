import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

const DEFAULT_OUTPUT_DIR = "docs/sprints";

function logPath(sprintNumber: number, outputDir: string): string {
  return path.join(outputDir, `sprint-${sprintNumber}-log.md`);
}

export function createSprintLog(
  sprintNumber: number,
  goal: string,
  plannedCount: number,
  outputDir: string = DEFAULT_OUTPUT_DIR,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const content = [
    `# Sprint ${sprintNumber} Log — ${date}`,
    "",
    `**Goal**: ${goal}`,
    `**Planned**: ${plannedCount} issues`,
    "",
    "## Huddles",
    "",
  ].join("\n");

  const filePath = logPath(sprintNumber, outputDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (err: unknown) {
    logger.warn({ err, filePath }, "Failed to write sprint log — continuing without log");
  }
  return filePath;
}

export function appendToSprintLog(
  sprintNumber: number,
  entry: string,
  outputDir: string = DEFAULT_OUTPUT_DIR,
): void {
  const filePath = logPath(sprintNumber, outputDir);
  try {
    fs.appendFileSync(filePath, entry + "\n", "utf-8");
  } catch (err: unknown) {
    logger.warn({ err, filePath }, "Failed to append to sprint log — continuing");
  }
}

export function readSprintLog(
  sprintNumber: number,
  outputDir: string = DEFAULT_OUTPUT_DIR,
): string {
  const filePath = logPath(sprintNumber, outputDir);
  return fs.readFileSync(filePath, "utf-8");
}

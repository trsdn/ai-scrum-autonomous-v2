/**
 * Auto-Improvement — Phase 4 (Self-Improvement)
 *
 * Applies auto-applicable retro improvements to config or prompt files.
 * Currently operates in dry-run mode: logs intended changes without
 * modifying files on disk (safety first).
 */

import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import type { RetroImprovement } from "../types.js";
import { logger } from "../logger.js";

export interface AppliedImprovement {
  improvement: RetroImprovement;
  applied: boolean;
  detail: string;
}

/**
 * Apply auto-applicable retro improvements to config or prompt files.
 *
 * Phase 4 implementation: all changes are logged but NOT written to disk.
 * Each improvement is returned with `applied: false` and a descriptive detail
 * explaining what would be changed.
 */
export async function applyImprovements(
  improvements: RetroImprovement[],
  configPath: string,
): Promise<AppliedImprovement[]> {
  const autoApplicable = improvements.filter((i) => i.autoApplicable);
  const results: AppliedImprovement[] = [];

  for (const improvement of autoApplicable) {
    const result = await applySingle(improvement, configPath);
    results.push(result);
  }

  return results;
}

async function applySingle(
  improvement: RetroImprovement,
  configPath: string,
): Promise<AppliedImprovement> {
  switch (improvement.target) {
    case "config":
      return applyConfigImprovement(improvement, configPath);

    case "agent":
    case "skill":
    case "process":
      return manualReviewNeeded(improvement);
  }
}

/**
 * Handle a config-targeted improvement.
 *
 * TODO: In a future phase, actually parse the YAML, apply the suggested
 * change, and write it back. For now we validate the config file exists
 * and log the intended change.
 */
function applyConfigImprovement(
  improvement: RetroImprovement,
  configPath: string,
): AppliedImprovement {
  if (!fs.existsSync(configPath)) {
    logger.warn({ configPath }, "Config file not found for auto-improvement");
    return {
      improvement,
      applied: false,
      detail: `Config file not found: ${configPath}`,
    };
  }

  // Read and parse to validate it's valid YAML
  const raw = fs.readFileSync(configPath, "utf-8");
  parseYaml(raw);

  // TODO: apply the actual change described in improvement.description
  logger.info(
    { title: improvement.title, target: improvement.target },
    "Planned config improvement (dry-run, not yet auto-applied)",
  );

  return {
    improvement,
    applied: false,
    detail: `Planned config change: ${improvement.description} (dry-run — not yet auto-applied)`,
  };
}

function manualReviewNeeded(
  improvement: RetroImprovement,
): AppliedImprovement {
  logger.info(
    { title: improvement.title, target: improvement.target },
    "Improvement requires manual review",
  );

  return {
    improvement,
    applied: false,
    detail: `Manual review needed for ${improvement.target} improvement: ${improvement.title}`,
  };
}

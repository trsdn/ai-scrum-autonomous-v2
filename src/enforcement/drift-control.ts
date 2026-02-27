import { logger } from "../logger.js";
import type { DriftReport } from "../types.js";

export interface DriftCheckResult {
  inScope: string[];
  outOfScope: string[];
  driftDetected: boolean;
}

export async function checkIssueDrift(
  changedFiles: string[],
  expectedFiles: string[],
): Promise<DriftCheckResult> {
  const log = logger.child({ module: "drift-control" });

  const expectedSet = new Set(expectedFiles);
  const inScope: string[] = [];
  const outOfScope: string[] = [];

  for (const file of changedFiles) {
    if (expectedSet.has(file)) {
      inScope.push(file);
    } else {
      outOfScope.push(file);
    }
  }

  const driftDetected = outOfScope.length > 0;

  log.debug(
    { inScope: inScope.length, outOfScope: outOfScope.length, driftDetected },
    "issue drift check",
  );

  return { inScope, outOfScope, driftDetected };
}

export async function holisticDriftCheck(
  allChangedFiles: string[],
  allExpectedFiles: string[],
): Promise<DriftReport> {
  const log = logger.child({ module: "drift-control" });

  // If no expected files were defined (planner didn't predict),
  // skip drift check — all changes are considered planned.
  if (allExpectedFiles.length === 0) {
    const report: DriftReport = {
      totalFilesChanged: allChangedFiles.length,
      plannedChanges: allChangedFiles.length,
      unplannedChanges: [],
      driftPercentage: 0,
    };
    log.info(
      { totalFilesChanged: report.totalFilesChanged },
      "holistic drift check skipped — no expectedFiles defined",
    );
    return report;
  }

  const expectedSet = new Set(allExpectedFiles);
  const unplannedChanges: string[] = [];

  for (const file of allChangedFiles) {
    if (!expectedSet.has(file)) {
      unplannedChanges.push(file);
    }
  }

  const totalFilesChanged = allChangedFiles.length;
  const plannedChanges = totalFilesChanged - unplannedChanges.length;
  const driftPercentage =
    totalFilesChanged > 0
      ? (unplannedChanges.length / totalFilesChanged) * 100
      : 0;

  const report: DriftReport = {
    totalFilesChanged,
    plannedChanges,
    unplannedChanges,
    driftPercentage,
  };

  log.info(
    { totalFilesChanged, plannedChanges, driftPercentage: driftPercentage.toFixed(1) },
    "holistic drift check",
  );

  return report;
}

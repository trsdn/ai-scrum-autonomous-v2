// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
// Multi-repo support — Phase 4
// TODO: Implement cross-repo sprint management

import type { SprintConfig } from "../types.js";

export interface RepoConfig {
  owner: string;
  repo: string;
  path: string;
  baseBranch: string;
}

export interface MultiRepoConfig {
  repos: RepoConfig[];
  sharedVelocity: boolean;
  crossRepoDeps: boolean;
}

/** Load multi-repo configuration (when supported). */
export function loadMultiRepoConfig(_config: SprintConfig): MultiRepoConfig | null {
  // TODO: Phase 4 — parse multi-repo config from sprint-runner.config.yaml
  return null;
}

/** Detect cross-repo dependencies from issue references. */
export function detectCrossRepoDeps(
  _repos: RepoConfig[],
): Map<string, string[]> {
  // TODO: Phase 4 — scan issues for cross-repo references (owner/repo#N)
  return new Map();
}

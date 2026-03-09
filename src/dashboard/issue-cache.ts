/**
 * Sprint Issue Cache
 *
 * In-memory cache for sprint issues. Preloads on start via a single
 * GraphQL batch query, serves instantly, refreshes on demand.
 */

import { logger } from "../logger.js";
import type { SprintState } from "../runner.js";

const log = logger.child({ component: "issue-cache" });

export interface CachedIssue {
  number: number;
  title: string;
  status: "planned" | "in-progress" | "done" | "failed";
}

export interface IssueCacheOptions {
  /** How often to refresh from GitHub (ms). Default: 120_000 (2 min). */
  refreshIntervalMs?: number;
  /** Maximum sprint number (used as upper bound). */
  maxSprint: number;
  /** Known milestones — sprint number + milestone number for GraphQL batch. */
  knownMilestones?: { sprintNumber: number; milestoneNumber: number }[];
  /** Known sprint numbers from milestones — only these get preloaded. */
  knownSprints?: number[];
  /** Function to load saved sprint state from disk. */
  loadState?: (sprintNumber: number) => SprintState | null;
  /** Sprint prefix for milestone queries (default: "Sprint"). */
  sprintPrefix?: string;
  /** GitHub repo owner (for GraphQL). */
  repoOwner?: string;
  /** GitHub repo name (for GraphQL). */
  repoName?: string;
}

interface GraphQLMilestoneNode {
  number: number;
  title: string;
  issues: {
    nodes: { number: number; title: string; state: string }[];
  };
}

export class SprintIssueCache {
  private cache = new Map<number, CachedIssue[]>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: IssueCacheOptions;
  private loading = false;

  constructor(options: IssueCacheOptions) {
    this.options = options;
  }

  /** Get cached issues for a sprint. Returns [] if not cached yet. */
  get(sprintNumber: number): CachedIssue[] {
    return this.cache.get(sprintNumber) ?? [];
  }

  /** Check if a sprint's issues are cached. */
  has(sprintNumber: number): boolean {
    return this.cache.has(sprintNumber);
  }

  /** Set issues for a sprint (used by active sprint tracking). */
  set(sprintNumber: number, issues: CachedIssue[]): void {
    this.cache.set(sprintNumber, issues);
  }

  /** Preload recent sprint issues via a single GraphQL batch query. */
  async preload(): Promise<void> {
    await this.batchFetchFromGitHub();
    log.info({ sprints: this.cache.size }, "Issue cache preloaded");
  }

  /** Start background refresh timer. */
  startRefresh(): void {
    const interval = this.options.refreshIntervalMs ?? 120_000;
    this.refreshTimer = setInterval(() => {
      this.batchFetchFromGitHub().catch((err) => {
        log.warn({ err }, "Background issue cache refresh failed");
      });
    }, interval);
    if (this.refreshTimer && "unref" in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }

  /** Stop background refresh. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Fetch issues for recent sprints in a single GraphQL query.
   * Falls back to REST if GraphQL fails or repo info missing.
   */
  private async batchFetchFromGitHub(): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      const { repoOwner, repoName } = this.options;
      const milestones = this.options.knownMilestones ?? [];
      const sprints = this.options.knownSprints ?? milestones.map((m) => m.sprintNumber);

      if (sprints.length === 0) return;

      // Last 20 sprints
      const sorted = [...sprints].sort((a, b) => b - a);
      const toLoad = sorted.slice(0, 20);

      if (repoOwner && repoName) {
        // GraphQL batch: 1 query for all milestones
        try {
          await this.graphqlBatchFetch(repoOwner, repoName, toLoad, milestones);
          return;
        } catch (err: unknown) {
          log.warn({ err }, "GraphQL batch failed, falling back to REST");
        }
      }

      // Fallback: sequential REST calls
      const { listIssues } = await import("../github/issues.js");
      for (const n of toLoad.slice(0, 10)) {
        try {
          const ghIssues = await listIssues({
            milestone: `${this.options.sprintPrefix ?? "Sprint"} ${n}`,
            state: "all",
          });
          this.cache.set(
            n,
            ghIssues.map((i) => ({
              number: i.number,
              title: i.title,
              status: (i.state.toLowerCase() === "closed"
                ? "done"
                : "planned") as CachedIssue["status"],
            })),
          );
        } catch {
          if (!this.cache.has(n)) this.cache.set(n, []);
        }
      }
    } finally {
      this.loading = false;
    }
  }

  /** Single GraphQL query fetching issues for multiple milestones. */
  private async graphqlBatchFetch(
    owner: string,
    repo: string,
    sprintNumbers: number[],
    milestones: { sprintNumber: number; milestoneNumber: number }[],
  ): Promise<void> {
    const { promisify } = await import("node:util");
    const { execFile: cpExecFile } = await import("node:child_process");
    const execFileAsync = promisify(cpExecFile);

    // Build milestone number filter string for GraphQL
    const milestoneMap = new Map(milestones.map((m) => [m.sprintNumber, m.milestoneNumber]));
    const milestoneNumbers = sprintNumbers
      .map((s) => milestoneMap.get(s))
      .filter((n): n is number => n !== undefined);

    if (milestoneNumbers.length === 0) return;

    // GraphQL: fetch milestones with their issues in one query
    // We query by milestone numbers using the milestones connection
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          milestones(first: 20, orderBy: {field: NUMBER, direction: DESC}, states: [OPEN, CLOSED]) {
            nodes {
              number
              title
              issues(first: 50, states: [OPEN, CLOSED]) {
                nodes {
                  number
                  title
                  state
                }
              }
            }
          }
        }
      }
    `;

    const { stdout } = await execFileAsync("gh", [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
    ]);

    const data = JSON.parse(stdout.trim()) as {
      data?: {
        repository?: {
          milestones?: { nodes?: GraphQLMilestoneNode[] };
        };
      };
    };

    const msNodes = data?.data?.repository?.milestones?.nodes ?? [];
    const prefix = this.options.sprintPrefix ?? "Sprint";

    // Map milestone title → sprint number, then cache issues
    for (const ms of msNodes) {
      const match = ms.title.match(new RegExp(`^${prefix}\\s+(\\d+)`, "i"));
      if (!match) continue;
      const sprintNum = parseInt(match[1], 10);
      if (!sprintNumbers.includes(sprintNum)) continue;

      this.cache.set(
        sprintNum,
        ms.issues.nodes.map((i) => ({
          number: i.number,
          title: i.title,
          status: (i.state.toLowerCase() === "closed"
            ? "done"
            : "planned") as CachedIssue["status"],
        })),
      );
    }

    // Mark missing sprints as empty
    for (const n of sprintNumbers) {
      if (!this.cache.has(n)) {
        this.cache.set(n, []);
      }
    }

    log.info(
      { milestones: msNodes.length, sprints: sprintNumbers.length },
      "GraphQL batch: loaded issues for all sprints in 1 query",
    );
  }
}

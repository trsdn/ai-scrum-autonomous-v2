import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { applyImprovements } from "../../src/improvement/auto-improve.js";
import type { AppliedImprovement } from "../../src/improvement/auto-improve.js";
import type { RetroImprovement } from "../../src/types.js";

vi.mock("node:fs");

const DUMMY_CONFIG_PATH = "/tmp/test-config.yaml";
const VALID_YAML = "project:\n  name: test\n";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(VALID_YAML);
});

// --- Helpers ---

function makeImprovement(
  overrides: Partial<RetroImprovement> = {},
): RetroImprovement {
  return {
    title: "Test improvement",
    description: "Increase max_parallel_sessions to 6",
    autoApplicable: true,
    target: "config",
    ...overrides,
  };
}

// --- Tests ---

describe("applyImprovements", () => {
  it("returns empty array when no improvements are auto-applicable", async () => {
    const improvements: RetroImprovement[] = [
      makeImprovement({ autoApplicable: false }),
      makeImprovement({ autoApplicable: false, target: "agent" }),
    ];

    const results = await applyImprovements(improvements, DUMMY_CONFIG_PATH);

    expect(results).toEqual([]);
  });

  it("handles config-targeted improvements in dry-run mode", async () => {
    const improvements: RetroImprovement[] = [
      makeImprovement({
        title: "Bump parallelism",
        description: "Set max_parallel_sessions to 6",
        target: "config",
      }),
    ];

    const results = await applyImprovements(improvements, DUMMY_CONFIG_PATH);

    expect(results).toHaveLength(1);
    const result = results[0] as AppliedImprovement;
    expect(result.applied).toBe(false);
    expect(result.detail).toContain("dry-run");
    expect(result.detail).toContain("Set max_parallel_sessions to 6");
    expect(result.improvement.target).toBe("config");
  });

  it("reports config file not found", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const results = await applyImprovements(
      [makeImprovement({ target: "config" })],
      "/nonexistent/path.yaml",
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.applied).toBe(false);
    expect(results[0]!.detail).toContain("not found");
  });

  it("handles mixed targets correctly", async () => {
    const improvements: RetroImprovement[] = [
      makeImprovement({ title: "Config tweak", target: "config" }),
      makeImprovement({ title: "Agent update", target: "agent" }),
      makeImprovement({ title: "Skill update", target: "skill" }),
      makeImprovement({ title: "Process update", target: "process" }),
      makeImprovement({ title: "Skipped", autoApplicable: false }),
    ];

    const results = await applyImprovements(improvements, DUMMY_CONFIG_PATH);

    // Only the 4 auto-applicable ones are processed (the 5th is filtered out)
    expect(results).toHaveLength(4);

    const configResult = results.find(
      (r) => r.improvement.title === "Config tweak",
    )!;
    expect(configResult.applied).toBe(false);
    expect(configResult.detail).toContain("dry-run");

    const agentResult = results.find(
      (r) => r.improvement.title === "Agent update",
    )!;
    expect(agentResult.applied).toBe(false);
    expect(agentResult.detail).toContain("Manual review needed");

    const skillResult = results.find(
      (r) => r.improvement.title === "Skill update",
    )!;
    expect(skillResult.applied).toBe(false);
    expect(skillResult.detail).toContain("Manual review needed");

    const processResult = results.find(
      (r) => r.improvement.title === "Process update",
    )!;
    expect(processResult.applied).toBe(false);
    expect(processResult.detail).toContain("Manual review needed");
  });
});

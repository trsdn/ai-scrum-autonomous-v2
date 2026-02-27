import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTRIBUTING_PATH = resolve(import.meta.dirname, "../CONTRIBUTING.md");

describe("CONTRIBUTING.md", () => {
  const content = readFileSync(CONTRIBUTING_PATH, "utf-8");
  const lines = content.split("\n");

  it("should contain development setup with prerequisites", () => {
    expect(content).toMatch(/Node\s*(\.js)?\s*20\+?/i);
    expect(content.toLowerCase()).toContain("npm");
    expect(content).toMatch(/prerequisites|setup|getting started/i);
  });

  it("should document test, lint, and build commands", () => {
    expect(content).toContain("npm test");
    expect(content).toContain("npm run lint");
    expect(content).toContain("npm run build");
  });

  it("should include branch naming conventions", () => {
    expect(content).toContain("feat/");
    expect(content).toContain("fix/");
    expect(content).toContain("docs/");
  });

  it("should include conventional commit format", () => {
    expect(content).toMatch(/conventional commits?/i);
    expect(content).toMatch(/feat|fix|docs|chore/);
  });

  it("should be under 100 lines", () => {
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});

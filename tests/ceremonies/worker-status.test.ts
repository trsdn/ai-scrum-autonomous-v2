import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkerTracker } from "../../src/ceremonies/worker-status.js";

describe("WorkerTracker", () => {
  let tracker: WorkerTracker;

  beforeEach(() => {
    tracker = new WorkerTracker();
  });

  describe("setStatus / getStatus", () => {
    it("creates a new worker entry on first call", () => {
      tracker.setStatus(42, "queued");
      const status = tracker.getStatus(42);
      expect(status).toBeDefined();
      expect(status!.issueNumber).toBe(42);
      expect(status!.status).toBe("queued");
    });

    it("sets startedAt when status is running", () => {
      tracker.setStatus(1, "running");
      const status = tracker.getStatus(1);
      expect(status!.startedAt).toBeInstanceOf(Date);
    });

    it("does not overwrite startedAt on subsequent running updates", () => {
      tracker.setStatus(1, "queued");
      tracker.setStatus(1, "running");
      const first = tracker.getStatus(1)!.startedAt;

      tracker.setStatus(1, "running");
      expect(tracker.getStatus(1)!.startedAt).toBe(first);
    });

    it("sets completedAt and duration_ms on completed", () => {
      vi.useFakeTimers();
      const start = new Date("2024-01-01T00:00:00Z");
      vi.setSystemTime(start);

      tracker.setStatus(5, "running");

      vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
      tracker.setStatus(5, "completed");

      const status = tracker.getStatus(5)!;
      expect(status.completedAt).toBeInstanceOf(Date);
      expect(status.duration_ms).toBe(5000);

      vi.useRealTimers();
    });

    it("sets completedAt and duration_ms on failed", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

      tracker.setStatus(10, "running");

      vi.setSystemTime(new Date("2024-01-01T00:00:03Z"));
      tracker.setStatus(10, "failed");

      const status = tracker.getStatus(10)!;
      expect(status.completedAt).toBeInstanceOf(Date);
      expect(status.duration_ms).toBe(3000);

      vi.useRealTimers();
    });

    it("returns undefined for unknown issue", () => {
      expect(tracker.getStatus(999)).toBeUndefined();
    });
  });

  describe("getAllStatuses", () => {
    it("returns all tracked workers", () => {
      tracker.setStatus(1, "queued");
      tracker.setStatus(2, "running");
      tracker.setStatus(3, "completed");

      const all = tracker.getAllStatuses();
      expect(all).toHaveLength(3);
      expect(all.map((w) => w.issueNumber).sort()).toEqual([1, 2, 3]);
    });

    it("returns empty array when no workers", () => {
      expect(tracker.getAllStatuses()).toEqual([]);
    });
  });

  describe("getProgress", () => {
    it("counts each status bucket correctly", () => {
      tracker.setStatus(1, "queued");
      tracker.setStatus(2, "queued");
      tracker.setStatus(3, "running");
      tracker.setStatus(4, "completed");
      tracker.setStatus(5, "failed");

      const progress = tracker.getProgress();
      expect(progress).toEqual({
        total: 5,
        completed: 1,
        failed: 1,
        running: 1,
        queued: 2,
      });
    });

    it("returns zeroes when empty", () => {
      expect(tracker.getProgress()).toEqual({
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        queued: 0,
      });
    });

    it("reflects status transitions", () => {
      tracker.setStatus(1, "queued");
      tracker.setStatus(2, "queued");

      tracker.setStatus(1, "running");
      expect(tracker.getProgress().running).toBe(1);
      expect(tracker.getProgress().queued).toBe(1);

      tracker.setStatus(1, "completed");
      expect(tracker.getProgress().completed).toBe(1);
      expect(tracker.getProgress().running).toBe(0);
    });
  });

  describe("formatProgressReport", () => {
    it("includes progress summary line", () => {
      tracker.setStatus(1, "completed");
      tracker.setStatus(2, "queued");

      const report = tracker.formatProgressReport();
      expect(report).toContain("Sprint Progress: 1/2 completed");
    });

    it("includes status counts", () => {
      tracker.setStatus(1, "completed");
      tracker.setStatus(2, "running");
      tracker.setStatus(3, "queued");
      tracker.setStatus(4, "failed");

      const report = tracker.formatProgressReport();
      expect(report).toContain("✅ Completed: 1");
      expect(report).toContain("🔄 Running:   1");
      expect(report).toContain("📋 Queued:    1");
      expect(report).toContain("❌ Failed:    1");
    });

    it("includes details for completed and failed workers", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      tracker.setStatus(42, "running");

      vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
      tracker.setStatus(42, "completed");

      const report = tracker.formatProgressReport();
      expect(report).toContain("✅ #42");
      expect(report).toContain("2000ms");

      vi.useRealTimers();
    });

    it("shows ❌ icon for failed workers", () => {
      tracker.setStatus(7, "failed");

      const report = tracker.formatProgressReport();
      expect(report).toContain("❌ #7");
    });

    it("produces valid report when empty", () => {
      const report = tracker.formatProgressReport();
      expect(report).toContain("Sprint Progress: 0/0 completed");
    });
  });
});

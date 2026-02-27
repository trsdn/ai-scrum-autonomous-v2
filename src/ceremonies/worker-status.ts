export interface WorkerStatus {
  issueNumber: number;
  status: "queued" | "running" | "completed" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  duration_ms?: number;
  qualityPassed?: boolean;
}

export class WorkerTracker {
  private workers: Map<number, WorkerStatus> = new Map();

  setStatus(issueNumber: number, status: WorkerStatus["status"]): void {
    const existing = this.workers.get(issueNumber);
    const now = new Date();

    if (!existing) {
      const entry: WorkerStatus = { issueNumber, status };
      if (status === "running") {
        entry.startedAt = now;
      }
      this.workers.set(issueNumber, entry);
      return;
    }

    existing.status = status;

    if (status === "running" && !existing.startedAt) {
      existing.startedAt = now;
    }

    if (status === "completed" || status === "failed") {
      existing.completedAt = now;
      if (existing.startedAt) {
        existing.duration_ms = now.getTime() - existing.startedAt.getTime();
      }
    }
  }

  getStatus(issueNumber: number): WorkerStatus | undefined {
    return this.workers.get(issueNumber);
  }

  getAllStatuses(): WorkerStatus[] {
    return [...this.workers.values()];
  }

  getProgress(): {
    total: number;
    completed: number;
    failed: number;
    running: number;
    queued: number;
  } {
    let completed = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;

    for (const w of this.workers.values()) {
      switch (w.status) {
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "running":
          running++;
          break;
        case "queued":
          queued++;
          break;
      }
    }

    return { total: this.workers.size, completed, failed, running, queued };
  }

  formatProgressReport(): string {
    const p = this.getProgress();
    const lines: string[] = [
      `Sprint Progress: ${p.completed}/${p.total} completed`,
      `  ✅ Completed: ${p.completed}`,
      `  🔄 Running:   ${p.running}`,
      `  📋 Queued:    ${p.queued}`,
      `  ❌ Failed:    ${p.failed}`,
    ];

    const completedWorkers = this.getAllStatuses().filter(
      (w) => w.status === "completed" || w.status === "failed",
    );

    if (completedWorkers.length > 0) {
      lines.push("");
      lines.push("Details:");
      for (const w of completedWorkers) {
        const dur = w.duration_ms != null ? ` (${w.duration_ms}ms)` : "";
        const icon = w.status === "completed" ? "✅" : "❌";
        lines.push(`  ${icon} #${w.issueNumber}${dur}`);
      }
    }

    return lines.join("\n");
  }
}

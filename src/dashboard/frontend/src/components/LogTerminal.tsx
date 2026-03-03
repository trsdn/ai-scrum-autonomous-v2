import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import "./LogTerminal.css";

type LogLevel = "all" | "error" | "warn" | "info";

export function LogTerminal() {
  const logs = useDashboardStore((s) => s.logs);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<LogLevel>("all");

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;
  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, filter]);

  return (
    <div className="log-terminal">
      <div className="log-terminal-header">
        <span className="log-terminal-title">⬤ Terminal</span>
        <div className="log-terminal-filters">
          <button className={`log-filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
            All ({logs.length})
          </button>
          <button className={`log-filter-btn log-filter-error ${filter === "error" ? "active" : ""}`} onClick={() => setFilter("error")}>
            {errorCount > 0 && <span className="log-error-badge">{errorCount}</span>}
            Errors
          </button>
          <button className={`log-filter-btn log-filter-warn ${filter === "warn" ? "active" : ""}`} onClick={() => setFilter("warn")}>
            {warnCount > 0 && <span className="log-warn-badge">{warnCount}</span>}
            Warnings
          </button>
        </div>
      </div>
      <div className="log-terminal-body">
        {filtered.length === 0 && (
          <div className="log-terminal-empty">
            {filter === "all" ? "Waiting for log output..." : `No ${filter} entries`}
          </div>
        )}
        {filtered.map((l, i) => (
          <div key={i} className={`log-line log-${l.level}`}>
            <span className="log-ts">
              {l.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className={`log-level log-level-${l.level}`}>{l.level.toUpperCase()}</span>
            <span className="log-text">{l.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

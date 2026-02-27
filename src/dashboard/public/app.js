// Sprint Runner Dashboard — Client-side JavaScript

(function () {
  "use strict";

  // --- State ---
  let ws = null;
  let state = { phase: "init", sprintNumber: 0, startedAt: null };
  let issues = [];
  let activities = [];
  let elapsedTimer = null;

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const sprintLabel = $("sprint-label");
  const phaseBadge = $("phase-badge");
  const issueCount = $("issue-count");
  const elapsedEl = $("elapsed");
  const btnStart = $("btn-start");
  const issueList = $("issue-list");
  const activityList = $("activity-list");
  const logPanel = $("log-panel");
  const connStatus = $("connection-status");
  const connLabel = $("connection-label");

  // --- WebSocket ---

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}`);

    connStatus.className = "status-dot status-connecting";
    connLabel.textContent = "Connecting…";

    ws.onopen = () => {
      connStatus.className = "status-dot status-connected";
      connLabel.textContent = "Connected";
    };

    ws.onclose = () => {
      connStatus.className = "status-dot status-disconnected";
      connLabel.textContent = "Disconnected — reconnecting…";
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch { /* ignore malformed */ }
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // --- Message handling ---

  function handleMessage(msg) {
    switch (msg.type) {
      case "sprint:state":
        state = msg.payload;
        if (state.startedAt) state.startedAt = new Date(state.startedAt);
        renderHeader();
        break;

      case "sprint:issues":
        issues = msg.payload || [];
        renderIssues();
        renderHeader();
        break;

      case "sprint:event":
        handleSprintEvent(msg.eventName, msg.payload);
        break;
    }
  }

  function handleSprintEvent(name, payload) {
    switch (name) {
      case "sprint:start":
        state.sprintNumber = payload.sprintNumber;
        state.phase = "refine";
        state.startedAt = new Date();
        renderHeader();
        addActivity("sprint", `Sprint ${payload.sprintNumber} started`, null, "active");
        break;

      case "phase:change":
        state.phase = payload.to;
        renderHeader();
        // Mark previous phase activities as done
        activities.forEach((a) => {
          if (a.type === "phase" && a.status === "active") a.status = "done";
        });
        const detail = payload.agent
          ? `${payload.agent}${payload.model ? ` (${payload.model})` : ""}`
          : payload.model || null;
        addActivity("phase", phaseLabel(payload.to), detail, "active");
        break;

      case "issue:start":
        updateIssueStatus(payload.issue.number, "in-progress");
        const issueLabel = `#${payload.issue.number} ${payload.issue.title}`;
        const model = payload.model ? `Agent: ${payload.model}` : null;
        addActivity("issue", issueLabel, model, "active");
        break;

      case "issue:progress":
        updateActivityDetail(payload.issueNumber, payload.step);
        break;

      case "issue:done":
        updateIssueStatus(payload.issueNumber, "done");
        updateActivityStatus(payload.issueNumber, "done", formatDuration(payload.duration_ms));
        break;

      case "issue:fail":
        updateIssueStatus(payload.issueNumber, "failed");
        updateActivityStatus(payload.issueNumber, "failed", payload.reason);
        break;

      case "sprint:complete":
        state.phase = "complete";
        renderHeader();
        addActivity("sprint", `Sprint ${payload.sprintNumber} complete`, null, "done");
        break;

      case "sprint:error":
        state.phase = "failed";
        renderHeader();
        addActivity("sprint", "Sprint error", payload.error, "failed");
        break;

      case "log":
        addLog(payload.level, payload.message);
        break;
    }
  }

  // --- Rendering ---

  function renderHeader() {
    sprintLabel.textContent = `Sprint ${state.sprintNumber || "—"}`;
    phaseBadge.textContent = state.phase;
    phaseBadge.className = `phase-badge phase-${state.phase}`;

    const done = issues.filter((i) => i.status === "done").length;
    issueCount.textContent = `${done}/${issues.length} done`;

    // Elapsed timer
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (state.startedAt && state.phase !== "complete" && state.phase !== "failed" && state.phase !== "init") {
      updateElapsed();
      elapsedTimer = setInterval(updateElapsed, 1000);
    } else if (state.startedAt) {
      updateElapsed();
    } else {
      elapsedEl.textContent = "0m 00s";
    }

    // Toggle start button
    const running = state.phase !== "init" && state.phase !== "complete" && state.phase !== "failed";
    btnStart.disabled = running;
    btnStart.textContent = running ? "⏳ Running" : "▶ Start";
  }

  function updateElapsed() {
    if (!state.startedAt) return;
    const ms = Date.now() - new Date(state.startedAt).getTime();
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    elapsedEl.textContent = `${min}m ${String(sec).padStart(2, "0")}s`;
  }

  function renderIssues() {
    issueList.innerHTML = "";
    for (const issue of issues) {
      const li = document.createElement("li");
      li.className = `issue-${issue.status}`;
      li.innerHTML = `
        <span class="issue-icon">${statusIcon(issue.status)}</span>
        <span class="issue-number">#${issue.number}</span>
        <span class="issue-title">${escapeHtml(issue.title)}</span>
      `;
      issueList.appendChild(li);
    }
  }

  function renderActivities() {
    activityList.innerHTML = "";
    for (const a of activities) {
      const li = document.createElement("li");
      li.className = `activity-${a.status}`;
      li.innerHTML = `
        <span class="activity-icon">${activityIcon(a.status)}</span>
        <div class="activity-content">
          <div class="activity-label">${escapeHtml(a.label)}</div>
          ${a.detail ? `<div class="activity-detail">${escapeHtml(a.detail)}</div>` : ""}
        </div>
        ${a.status === "active" && a.startedAt ? `<span class="activity-elapsed" data-started="${a.startedAt}"></span>` : ""}
      `;
      activityList.appendChild(li);
    }
    // Scroll to bottom
    activityList.scrollTop = activityList.scrollHeight;
  }

  // --- Activity helpers ---

  function addActivity(type, label, detail, status) {
    activities.push({ type, label, detail, status, startedAt: status === "active" ? Date.now() : null });
    renderActivities();
  }

  function updateIssueStatus(issueNumber, status) {
    const issue = issues.find((i) => i.number === issueNumber);
    if (issue) {
      issue.status = status;
      renderIssues();
      renderHeader();
    }
  }

  function updateActivityDetail(issueNumber, step) {
    const prefix = `#${issueNumber}`;
    for (let i = activities.length - 1; i >= 0; i--) {
      if (activities[i].label.startsWith(prefix) && activities[i].status === "active") {
        activities[i].detail = step;
        renderActivities();
        return;
      }
    }
  }

  function updateActivityStatus(issueNumber, status, detail) {
    const prefix = `#${issueNumber}`;
    for (let i = activities.length - 1; i >= 0; i--) {
      if (activities[i].label.startsWith(prefix)) {
        activities[i].status = status;
        if (detail) activities[i].detail = detail;
        activities[i].startedAt = null;
        renderActivities();
        return;
      }
    }
  }

  function addLog(level, message) {
    const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level log-level-${level}">${level.toUpperCase()}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    `;
    logPanel.appendChild(div);
    logPanel.scrollTop = logPanel.scrollHeight;
  }

  // --- Utility ---

  function statusIcon(status) {
    switch (status) {
      case "planned": return "○";
      case "in-progress": return "●";
      case "done": return "✓";
      case "failed": return "✗";
      default: return "○";
    }
  }

  function activityIcon(status) {
    switch (status) {
      case "active": return "▸";
      case "done": return "✓";
      case "failed": return "✗";
      default: return "·";
    }
  }

  function phaseLabel(phase) {
    const labels = {
      refine: "Refining backlog",
      plan: "Planning sprint",
      execute: "Executing issues",
      review: "Sprint review",
      retro: "Retrospective",
    };
    return labels[phase] || phase;
  }

  function formatDuration(ms) {
    if (!ms) return "";
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    return min > 0 ? `${min}m ${sec % 60}s` : `${sec}s`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Activity elapsed timer ---
  setInterval(() => {
    const spans = document.querySelectorAll(".activity-elapsed[data-started]");
    for (const span of spans) {
      const started = parseInt(span.dataset.started, 10);
      const ms = Date.now() - started;
      const sec = Math.floor(ms / 1000);
      const min = Math.floor(sec / 60);
      span.textContent = min > 0 ? `${min}m ${String(sec % 60).padStart(2, "0")}s` : `${sec}s`;
    }
  }, 1000);

  // --- Init ---

  btnStart.addEventListener("click", () => {
    send({ type: "sprint:start" });
    btnStart.disabled = true;
    btnStart.textContent = "⏳ Starting…";
  });

  connect();
})();

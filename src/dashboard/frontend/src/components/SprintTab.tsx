import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { IssueList } from "./IssueList";
import { ActivityFeed } from "./ActivityFeed";
import { SessionPanel } from "./SessionPanel";
import "./SprintTab.css";

export function SprintTab() {
  return (
    <main className="sprint-main">
      <Allotment>
        <Allotment.Pane minSize={200} preferredSize={360}>
          <div className="panel">
            <h2 className="panel-title">Issues</h2>
            <IssueList />
          </div>
        </Allotment.Pane>

        <Allotment.Pane minSize={250}>
          <div className="panel">
            <h2 className="panel-title">Activity</h2>
            <ActivityFeed />
          </div>
        </Allotment.Pane>

        <Allotment.Pane minSize={200} preferredSize={380}>
          <div className="panel">
            <h2 className="panel-title">ACP Sessions</h2>
            <SessionPanel />
          </div>
        </Allotment.Pane>
      </Allotment>
    </main>
  );
}

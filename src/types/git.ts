export interface Worktree {
  path: string;
  branch: string;
  issueNumber: number;
}

export interface DiffStat {
  linesChanged: number;
  filesChanged: number;
  files: string[];
}

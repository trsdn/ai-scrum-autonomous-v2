export interface DriftReport {
  totalFilesChanged: number;
  plannedChanges: number;
  unplannedChanges: string[];
  driftPercentage: number;
}

export interface DriftIncident {
  issueNumber: number;
  files: string[];
}

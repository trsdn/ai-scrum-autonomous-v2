export interface ReviewResult {
  summary: string;
  demoItems: string[];
  velocityUpdate: string;
  openItems: string[];
}

export interface RetroImprovement {
  title: string;
  description: string;
  autoApplicable: boolean;
  target: "config" | "agent" | "skill" | "process";
}

export interface RetroResult {
  wentWell: string[];
  wentBadly: string[];
  improvements: RetroImprovement[];
  previousImprovementsChecked: boolean;
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail: string;
  category: "lint" | "test" | "type" | "build" | "diff" | "other";
}

export interface QualityResult {
  passed: boolean;
  checks: QualityCheck[];
}

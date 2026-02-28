export type EscalationLevel = "must" | "should" | "info";

export interface EscalationEvent {
  level: EscalationLevel;
  reason: string;
  detail: string;
  context: Record<string, unknown>;
  timestamp: Date;
  issueNumber?: number;
}

import type { Config } from "./config";

export type TaskStatus = "queued" | "processing" | "ready" | "review" | "approved" | "failed";
export type BatchState = "idle" | "running" | "paused";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

export interface Preset {
  id: string;
  name: string;
  config: string;
  created: number;
}

export interface Batch {
  id: string;
  name: string;
  config: string; // JSON of Config
  state: BatchState;
  last_error?: string | null;
  created: number;
  updated: number;
  /** Present on the batches list only. */
  spent?: number;
  total?: number;
  completed?: number;
  review?: number;
  failed?: number;
  queued?: number;
}

export interface EngineModel {
  slug: string;
  name: string;
  enabled: boolean;
  reason: string;
}

export interface Source {
  id: string;
  name: string;
  mime: string;
  size: number;
  role: "lead" | "supporting";
  created: number;
}

export interface QA {
  found: boolean;
  count: number;
  box: number[];
  productConcern: boolean;
  /** false when the studio card does not show the same face as card 1 */
  sameFace?: boolean;
  notes: string;
  offset?: number;
  centered?: boolean;
  automated: boolean;
}

export interface Task {
  id: string;
  source: string;
  card: number;
  status: TaskStatus;
  output: string | null;
  qa: string | null;
  error: string | null;
  prompt: string;
  attempts: number;
  request_id: string | null;
  /** JSON EditorialBrief for editorial-mode tasks. */
  brief: string | null;
  /** Estimated spend so far on this task (all attempts). */
  cost: number;
  updated: number;
}

/** A skill as the team sees and edits it. */
export interface SkillInfo {
  id: string;
  title: string;
  caption: string;
  description: string;
  goal: string;
  library: string;
  builtIn: boolean;
  edited: boolean;
}

export interface StateResponse {
  user: User;
  batches: Batch[];
  spendThreshold: number;
  zaidDirection: string;
  engine: {
    model: string;
    configured: boolean;
    source: "secret" | "stored" | "none";
    openai: "secret" | "stored" | "none";
    google: "secret" | "stored" | "none";
    fal: "secret" | "stored" | "none";
    review: boolean;
  };
}

export interface BatchResponse {
  batch: Batch;
  sources: Source[];
  tasks: Task[];
}

export interface BatchSummary {
  total: number;
  completed: number;
  queued: number;
  processing: number;
  review: number;
  ready: number;
  failed: number;
}

export type { Config };

import type { Config } from "./config";

export type TaskStatus = "queued" | "processing" | "ready" | "review" | "approved" | "failed";
export type BatchState = "idle" | "running" | "paused";

export interface User {
  id: string;
  email: string;
  name: string;
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
  updated: number;
}

export interface StateResponse {
  user: User;
  batches: Batch[];
  engine: {
    model: string;
    configured: boolean;
    source: "secret" | "stored" | "none";
    openai: "secret" | "stored" | "none";
    google: "secret" | "stored" | "none";
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

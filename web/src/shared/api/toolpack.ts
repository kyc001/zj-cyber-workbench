import { apiGet, apiPost } from "./client";
import { buildQuery } from "./query";
import type { CommonResponsePayload } from "./types";

export type ToolBackend = "local" | "ssh";
export type ToolRunStatus = "running" | "completed" | "failed" | "canceled";
export type JsonSchemaProperty = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  enum?: unknown[];
};

export type ToolInputSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  additionalProperties?: boolean;
};

export type ToolManifest = {
  id: string;
  name: string;
  description: string;
  backend: ToolBackend;
  executable: string;
  category: string;
  action_type: string;
  risk_level: string;
  default_timeout_seconds: number;
  max_timeout_seconds: number;
  input_schema: ToolInputSchema;
  output_schema: Record<string, unknown>;
  policy: Record<string, unknown>;
};

export type ToolSchema = {
  id: string;
  name: string;
  description: string;
  backend: ToolBackend;
  category: string;
  available: boolean | null;
  availability_message: string;
  install_hint: string;
  manifest: ToolManifest;
};

export type ExecutionArtifact = {
  id: string;
  path: string;
  media_type: string;
  size: number;
};

export type ExecutionResult = {
  ok: boolean;
  execution_id: string;
  summary: string;
  structured: {
    stdout?: string;
    records?: unknown[];
    [key: string]: unknown;
  };
  artifact_refs: ExecutionArtifact[];
  exit_code: number | null;
  started_at: string;
  finished_at: string;
  truncated: boolean;
  error_code: string | null;
};

export type ToolRunSnapshot = {
  run_id: string;
  tool_id: string;
  sandbox_container_id: number;
  status: ToolRunStatus;
  result: ExecutionResult | null;
  started_at: string;
  finished_at: string | null;
};

export type QueryToolpackToolsResponse = CommonResponsePayload & {
  data?: { tools: ToolSchema[] } | null;
};

export type ToolRunResponse = CommonResponsePayload & {
  data?: ToolRunSnapshot | null;
};

export type ToolRunCancelResponse = CommonResponsePayload & {
  data?: { run_id: string; canceled: boolean; status: ToolRunStatus } | null;
};

const TOOLPACK_PATH = "/api/toolpack";

export function listToolpackTools(sandboxContainerId?: number) {
  return apiGet<QueryToolpackToolsResponse>(`${TOOLPACK_PATH}/tools${buildQuery({ sandbox_container_id: sandboxContainerId })}`);
}

export function startToolRun(toolId: string, payload: {
  sandbox_container_id: number;
  input: Record<string, unknown>;
  timeout_seconds?: number;
}) {
  return apiPost<ToolRunResponse>(`${TOOLPACK_PATH}/tools/${encodeURIComponent(toolId)}/runs`, payload);
}

export function getToolRun(runId: string) {
  return apiGet<ToolRunResponse>(`${TOOLPACK_PATH}/runs/${encodeURIComponent(runId)}`);
}

export function cancelToolRun(runId: string) {
  return apiPost<ToolRunCancelResponse>(`${TOOLPACK_PATH}/runs/${encodeURIComponent(runId)}/cancel`);
}

export function buildToolArtifactUrl(artifactId: string) {
  return `${TOOLPACK_PATH}/artifacts/${encodeURIComponent(artifactId)}`;
}

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  FetchProviderModelsRequest,
  FetchProviderModelsResponse,
  GetInstanceConfigResponse,
  UpdateInstanceConfigRequest,
  UpdateInstanceConfigResponse,
} from "./types";

const SYSTEM_CONFIG_PATH = "/api/system-config";

export function getInstanceConfig() {
  return apiGet<GetInstanceConfigResponse>(`${SYSTEM_CONFIG_PATH}/instance`);
}

export function updateInstanceConfig(payload: UpdateInstanceConfigRequest) {
  return apiPatch<UpdateInstanceConfigResponse>(`${SYSTEM_CONFIG_PATH}/instance`, payload);
}

export function fetchProviderModels(payload: FetchProviderModelsRequest) {
  return apiPost<FetchProviderModelsResponse>(`${SYSTEM_CONFIG_PATH}/models`, payload);
}

export type AgentPromptKind = "soul" | "rules";
export type CustomizationSource = "builtin" | "custom";

export type AgentPrompt = {
  agent_code: string;
  kind: AgentPromptKind;
  content: string;
  customized: boolean;
  source: CustomizationSource;
};

export type SkillSummary = {
  name: string;
  source: CustomizationSource;
  editable: boolean;
  description: string;
};

export type SkillDetail = SkillSummary & {
  content: string;
};

type AgentPromptResponse = {
  data?: AgentPrompt | null;
};

type SkillDetailResponse = {
  data?: SkillDetail | null;
};

type SkillListResponse = {
  data?: { items: SkillSummary[] } | null;
};

const CUSTOMIZATION_PATH = `${SYSTEM_CONFIG_PATH}/agent-customization`;

export function getAgentPrompt(agentCode: string, kind: AgentPromptKind) {
  return apiGet<AgentPromptResponse>(`${CUSTOMIZATION_PATH}/agents/${encodeURIComponent(agentCode)}/prompt?kind=${kind}`);
}

export function updateAgentPrompt(agentCode: string, payload: { kind: AgentPromptKind; content: string }) {
  return apiPatch<AgentPromptResponse>(`${CUSTOMIZATION_PATH}/agents/${encodeURIComponent(agentCode)}/prompt`, payload);
}

export function resetAgentPrompt(agentCode: string, kind: AgentPromptKind) {
  return apiDelete<AgentPromptResponse>(`${CUSTOMIZATION_PATH}/agents/${encodeURIComponent(agentCode)}/prompt?kind=${kind}`);
}

export function listCustomizableSkills() {
  return apiGet<SkillListResponse>(`${CUSTOMIZATION_PATH}/skills`);
}

export function getCustomizableSkill(name: string) {
  return apiGet<SkillDetailResponse>(`${CUSTOMIZATION_PATH}/skills/${encodeURIComponent(name)}`);
}

export function createCustomSkill(payload: { name: string; content: string }) {
  return apiPost<SkillDetailResponse>(`${CUSTOMIZATION_PATH}/skills`, payload);
}

export function updateCustomSkill(name: string, payload: { content: string }) {
  return apiPatch<SkillDetailResponse>(`${CUSTOMIZATION_PATH}/skills/${encodeURIComponent(name)}`, payload);
}

export function deleteCustomSkill(name: string) {
  return apiDelete(`${CUSTOMIZATION_PATH}/skills/${encodeURIComponent(name)}`);
}

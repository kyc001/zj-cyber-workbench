import { apiGet, apiPatch, apiPost } from "./client";
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

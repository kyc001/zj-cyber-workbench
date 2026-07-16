import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  RuntimePermissionDecision,
  RuntimePermissionDecisionResponse,
  RuntimePermissionSettingsResponse,
  RuntimePermissionsResponse,
  UpdateRuntimePermissionSettingsRequest,
} from "./types";

const PERMISSIONS_PATH = "/api/runtime-permissions";

export function getPendingRuntimePermissions() {
  return apiGet<RuntimePermissionsResponse>(`${PERMISSIONS_PATH}/pending`);
}

export function decideRuntimePermission(requestId: string, decision: RuntimePermissionDecision) {
  return apiPost<RuntimePermissionDecisionResponse>(`${PERMISSIONS_PATH}/${requestId}/decision`, { decision });
}

export function getRuntimePermissionSettings() {
  return apiGet<RuntimePermissionSettingsResponse>(`${PERMISSIONS_PATH}/settings`);
}

export function updateRuntimePermissionSettings(payload: UpdateRuntimePermissionSettingsRequest) {
  return apiPatch<RuntimePermissionSettingsResponse>(`${PERMISSIONS_PATH}/settings`, payload);
}

export function clearRuntimePermissionRules() {
  return apiDelete<RuntimePermissionSettingsResponse>(`${PERMISSIONS_PATH}/rules`);
}

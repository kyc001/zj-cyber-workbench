import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { buildQuery } from "./query";
import type {
  CreateSystemUserRequest,
  CreateSystemUserResponse,
  DeleteSystemUserResponse,
  QuerySystemUsersParams,
  QuerySystemUsersResponse,
  SystemUserPathParams,
  UpdateSystemUserRequest,
  UpdateSystemUserResponse,
} from "./types";

const SYSTEM_USERS_PATH = "/api/system-users";

export function querySystemUsers(params: QuerySystemUsersParams) {
  return apiGet<QuerySystemUsersResponse>(`${SYSTEM_USERS_PATH}${buildQuery(params)}`);
}

export function createSystemUser(payload: CreateSystemUserRequest) {
  return apiPost<CreateSystemUserResponse>(SYSTEM_USERS_PATH, payload);
}

export function updateSystemUser(id: SystemUserPathParams["id"], payload: UpdateSystemUserRequest) {
  return apiPatch<UpdateSystemUserResponse>(`${SYSTEM_USERS_PATH}/${id}`, payload);
}

export function deleteSystemUser(id: SystemUserPathParams["id"]) {
  return apiDelete<DeleteSystemUserResponse>(`${SYSTEM_USERS_PATH}/${id}`);
}

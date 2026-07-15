import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { buildQuery } from "./query";
import type {
  CancelWorkProjectPathParams,
  CancelWorkProjectResponse,
  CreateWorkProjectRequest,
  CreateWorkProjectResponse,
  CreateWorkProjectSessionResponse,
  DiscoverWorkProjectCvesRequest,
  DiscoverWorkProjectCvesResponse,
  DeleteWorkProjectSessionResponse,
  DeleteWorkProjectResponse,
  GetWorkProjectRecordSnapshotResponse,
  ImportWorkProjectCveRequest,
  ImportWorkProjectCveResponse,
  ListWorkProjectSessionsResponse,
  QueryWorkProjectsParams,
  QueryWorkProjectsResponse,
  RetryWorkProjectPathParams,
  RetryWorkProjectResponse,
  UpdateWorkProjectMetadataRequest,
  UpdateWorkProjectMetadataResponse,
  WorkProjectPathParams,
} from "./types";

const WORK_PROJECTS_PATH = "/api/work-projects";

export function queryWorkProjects(params: QueryWorkProjectsParams) {
  return apiGet<QueryWorkProjectsResponse>(`${WORK_PROJECTS_PATH}${buildQuery(params)}`);
}

export function createWorkProject(payload: CreateWorkProjectRequest) {
  return apiPost<CreateWorkProjectResponse>(WORK_PROJECTS_PATH, payload);
}

export function getWorkProjectRecordSnapshot(id: WorkProjectPathParams["id"]) {
  return apiGet<GetWorkProjectRecordSnapshotResponse>(`${WORK_PROJECTS_PATH}/${id}/record-snapshot`);
}

export function discoverWorkProjectCves(id: number, payload: DiscoverWorkProjectCvesRequest) {
  return apiPost<DiscoverWorkProjectCvesResponse>(`${WORK_PROJECTS_PATH}/${id}/cve-discovery/query`, payload);
}

export function importWorkProjectCve(id: number, payload: ImportWorkProjectCveRequest) {
  return apiPost<ImportWorkProjectCveResponse>(`${WORK_PROJECTS_PATH}/${id}/cve-discovery/import`, payload);
}

export function updateWorkProjectMetadata(id: WorkProjectPathParams["id"], payload: UpdateWorkProjectMetadataRequest) {
  return apiPatch<UpdateWorkProjectMetadataResponse>(`${WORK_PROJECTS_PATH}/${id}/metadata`, payload);
}

export function listWorkProjectSessions(id: WorkProjectPathParams["id"]) {
  return apiGet<ListWorkProjectSessionsResponse>(`${WORK_PROJECTS_PATH}/${id}/sessions`);
}

export function createWorkProjectSession(id: WorkProjectPathParams["id"]) {
  return apiPost<CreateWorkProjectSessionResponse>(`${WORK_PROJECTS_PATH}/${id}/sessions`);
}

export function deleteWorkProjectSession(id: WorkProjectPathParams["id"], sessionId: string) {
  return apiDelete<DeleteWorkProjectSessionResponse>(
    `${WORK_PROJECTS_PATH}/${id}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export function cancelWorkProject(id: CancelWorkProjectPathParams["id"]) {
  return apiPost<CancelWorkProjectResponse>(`${WORK_PROJECTS_PATH}/${id}/cancel`);
}

export function retryWorkProject(id: RetryWorkProjectPathParams["id"]) {
  return apiPost<RetryWorkProjectResponse>(`${WORK_PROJECTS_PATH}/${id}/retry`);
}

export function deleteWorkProject(id: WorkProjectPathParams["id"]) {
  return apiDelete<DeleteWorkProjectResponse>(`${WORK_PROJECTS_PATH}/${id}`);
}

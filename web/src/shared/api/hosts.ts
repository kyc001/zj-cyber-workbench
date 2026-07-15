import { apiDelete, apiGet, apiPatch, apiPost, buildWebSocketUrl } from "./client";
import { buildQuery } from "./query";
import type {
  CreateManagedHostRequest,
  CreateManagedHostResponse,
  DeleteManagedHostImageRequest,
  DeleteManagedHostResponse,
  ListManagedHostImagesResponse,
  ManagedHostPathParams,
  PullManagedHostImagesRequest,
  PullManagedHostImagesResponse,
  QueryManagedHostsParams,
  QueryManagedHostsResponse,
  UpdateManagedHostRequest,
  UpdateManagedHostResponse,
} from "./types";

const HOSTS_PATH = "/api/hosts";

export type ManagedHostKeyInfo = {
  host_id: number;
  endpoint: string;
  algorithm: string;
  fingerprint_sha256: string;
  public_key: string;
  trusted: boolean;
};

export type ManagedHostKeyResponse = {
  code: number;
  message: string;
  data?: ManagedHostKeyInfo;
};

export function queryManagedHosts(params: QueryManagedHostsParams) {
  return apiGet<QueryManagedHostsResponse>(`${HOSTS_PATH}${buildQuery(params)}`);
}

export function createManagedHost(payload: CreateManagedHostRequest) {
  return apiPost<CreateManagedHostResponse>(HOSTS_PATH, payload);
}

export function updateManagedHost(id: ManagedHostPathParams["id"], payload: UpdateManagedHostRequest) {
  return apiPatch<UpdateManagedHostResponse>(`${HOSTS_PATH}/${id}`, payload);
}

export function deleteManagedHost(id: ManagedHostPathParams["id"]) {
  return apiDelete<DeleteManagedHostResponse>(`${HOSTS_PATH}/${id}`);
}

export function listManagedHostImages(id: ManagedHostPathParams["id"]) {
  return apiGet<ListManagedHostImagesResponse>(`${HOSTS_PATH}/${id}/images`);
}

export function pullManagedHostImages(id: ManagedHostPathParams["id"], payload: PullManagedHostImagesRequest) {
  return apiPost<PullManagedHostImagesResponse>(`${HOSTS_PATH}/${id}/images/pull`, payload);
}

export function removeManagedHostImage(id: ManagedHostPathParams["id"], payload: DeleteManagedHostImageRequest) {
  return apiPost(`${HOSTS_PATH}/${id}/images/remove`, payload);
}

export function previewManagedHostKey(id: ManagedHostPathParams["id"]) {
  return apiGet<ManagedHostKeyResponse>(`${HOSTS_PATH}/${id}/host-key`);
}

export function trustManagedHostKey(id: ManagedHostPathParams["id"], fingerprintSha256: string) {
  return apiPost<ManagedHostKeyResponse>(`${HOSTS_PATH}/${id}/host-key/trust`, {
    fingerprint_sha256: fingerprintSha256,
  });
}

export function buildHostShellUrl(id: ManagedHostPathParams["id"]) {
  return buildWebSocketUrl(`${HOSTS_PATH}/${id}/shell`);
}

import { apiDelete, apiGet, apiPost } from "./client";

export type HubSkillVersion = {
  version: string;
  changelog: string;
  sha256: string;
  size_bytes: number;
  scan_status: string;
  scan_warnings: string[];
  published_at: string;
};

export type HubSkillSummary = {
  namespace: string;
  slug: string;
  name: string;
  summary: string;
  tags: string[];
  latest_version: string;
  downloads: number;
  stars: number;
  rating_average: number;
  rating_count: number;
  updated_at: string;
};

export type HubSkillDetail = HubSkillSummary & {
  description: string;
  visibility: string;
  author_username: string;
  versions: HubSkillVersion[];
};

export type InstalledHubSkill = {
  name: string;
  namespace: string;
  slug: string;
  version: string;
  sha256: string;
  installed_at: string;
};

type HubSkillListResponse = {
  data?: {
    items: HubSkillSummary[];
    total: number;
    page: number;
    page_size: number;
  } | null;
};

type HubSkillDetailResponse = {
  data?: HubSkillDetail | null;
};

type InstalledHubSkillsResponse = {
  data?: { items: InstalledHubSkill[] } | null;
};

type InstallHubSkillResponse = {
  data?: {
    installed: InstalledHubSkill;
    updated: boolean;
  } | null;
};

const HUB_PATH = "/api/skill-hub";

export function listHubSkills(params: { q?: string; sort?: string } = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.sort) query.set("sort", params.sort);
  return apiGet<HubSkillListResponse>(`${HUB_PATH}/skills?${query}`);
}

export function getHubSkill(namespace: string, slug: string) {
  return apiGet<HubSkillDetailResponse>(
    `${HUB_PATH}/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`,
  );
}

export function listInstalledHubSkills() {
  return apiGet<InstalledHubSkillsResponse>(`${HUB_PATH}/installed`);
}

export function installHubSkill(payload: { namespace: string; slug: string; version?: string }) {
  return apiPost<InstallHubSkillResponse>(`${HUB_PATH}/install`, payload);
}

export function uninstallHubSkill(name: string) {
  return apiDelete(`${HUB_PATH}/installed/${encodeURIComponent(name)}`);
}

import type {
  AuthResponse,
  HubNamespace,
  HubUser,
  SkillDetail,
  SkillList,
  SkillSummary,
} from "./types";

const API_BASE = (import.meta.env.VITE_SKILL_HUB_API_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "zj-skill-hub-token";

export class HubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HubApiError";
    this.status = status;
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function storeToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (error) {
    throw new HubApiError(0, error instanceof Error ? error.message : "网络连接失败");
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the status-based message for non-JSON responses.
    }
    throw new HubApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function register(payload: {
  username: string;
  email: string;
  display_name: string;
  password: string;
}) {
  return request<AuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { username_or_email: string; password: string }) {
  return request<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMe() {
  return request<HubUser>("/api/v1/auth/me");
}

export function listNamespaces() {
  return request<HubNamespace[]>("/api/v1/namespaces");
}

export function listSkills(params: {
  q?: string;
  namespace?: string;
  sort?: string;
  page?: number;
}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.namespace) query.set("namespace", params.namespace);
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  return request<SkillList>(`/api/v1/skills?${query}`);
}

export function getSkill(namespace: string, slug: string) {
  return request<SkillDetail>(
    `/api/v1/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`,
  );
}

export function getMySkills() {
  return request<SkillSummary[]>("/api/v1/me/skills");
}

export function publishSkill(form: FormData) {
  return request<SkillDetail>("/api/v1/skills/publish", {
    method: "POST",
    body: form,
  });
}

export function setStar(namespace: string, slug: string, starred: boolean) {
  return request<void>(
    `/api/v1/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/star`,
    { method: starred ? "POST" : "DELETE" },
  );
}

export function rateSkill(namespace: string, slug: string, score: number) {
  return request<void>(
    `/api/v1/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/rating`,
    { method: "POST", body: JSON.stringify({ score }) },
  );
}

export function downloadUrl(namespace: string, slug: string, version: string) {
  const selected = encodeURIComponent(version);
  return `${API_BASE}/api/v1/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}/download?version=${selected}`;
}

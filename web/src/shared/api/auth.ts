import { apiGet, apiPost } from "./client";
import type { SystemUserRole } from "./types";

export type AuthUser = {
  id: number;
  role: SystemUserRole;
  email: string;
  username: string;
  display_name?: string;
  auth_mode?: string;
};

export type AuthSession = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
};

export type AuthResponse = {
  code: number;
  message: string;
  data?: AuthSession | null;
};

export type CurrentUserResponse = {
  code: number;
  message: string;
  data?: AuthUser | null;
};

const AUTH_PATH = "/api/auth";

export function login(payload: { username_or_email: string; password: string }) {
  return apiPost<AuthResponse>(`${AUTH_PATH}/login`, payload);
}

export function register(payload: {
  username: string;
  email: string;
  display_name: string;
  password: string;
}) {
  return apiPost<AuthResponse>(`${AUTH_PATH}/register`, payload);
}

export function getCurrentUser() {
  return apiGet<CurrentUserResponse>(`${AUTH_PATH}/me`);
}

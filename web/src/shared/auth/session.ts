const ACCESS_TOKEN_KEY = "zj-auth-access-token";

export function getStoredAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

export function storeAccessToken(token: string) {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
}

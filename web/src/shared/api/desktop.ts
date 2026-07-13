type DesktopBootstrapPayload = {
  token?: unknown;
};

export async function bootstrapDesktopSession(): Promise<string> {
  const response = await fetch("/desktop/bootstrap", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`桌面会话初始化失败，HTTP ${response.status}`);
  }

  const payload = await response.json() as DesktopBootstrapPayload;
  if (typeof payload.token !== "string" || !payload.token) {
    throw new Error("桌面会话初始化未返回令牌");
  }
  return payload.token;
}

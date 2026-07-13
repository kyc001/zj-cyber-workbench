type DesktopBootstrapPayload = {
  token?: unknown;
};

export async function bootstrapDesktopSession(): Promise<string> {
  const response = await fetch("/desktop/bootstrap", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Desktop session bootstrap failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as DesktopBootstrapPayload;
  if (typeof payload.token !== "string" || !payload.token) {
    throw new Error("Desktop session bootstrap returned no token");
  }
  return payload.token;
}

type DesktopWindow = Window & {
  zj?: {
    desktop?: unknown;
  };
};

export function isDesktopRuntime(): boolean {
  const electronDesktop = typeof window !== "undefined" && Boolean((window as DesktopWindow).zj?.desktop);
  const browserDesktop = typeof import.meta !== "undefined" && import.meta.env?.VITE_DESKTOP_MODE === "true";
  return electronDesktop || browserDesktop;
}

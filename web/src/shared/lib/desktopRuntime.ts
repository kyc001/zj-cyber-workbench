type DesktopWindow = Window & {
  zj?: {
    desktop?: unknown;
  };
};

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as DesktopWindow).zj?.desktop);
}

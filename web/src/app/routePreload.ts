const routeLoaders = {
  protectedAdminShell: () => import("./layouts/ProtectedAdminShell"),
  egressProxies: () => import("../features/egress-proxies/EgressProxiesPage"),
  hosts: () => import("../features/hosts/HostsPage"),
  knowledges: () => import("../features/knowledges/KnowledgesPage"),
  playground: () => import("../features/playground/PlaygroundPage"),
  workProjects: () => import("../features/work-projects/WorkProjectsPage"),
  workProjectWorkspace: () => import("../features/work-projects/WorkProjectWorkspacePage"),
  sandboxImages: () => import("../features/sandbox-images/SandboxImagesPage"),
  sandboxContainers: () => import("../features/sandbox-containers/SandboxContainersPage"),
  toolpack: () => import("../features/toolpack/ToolpackPage"),
  systemConfig: () => import("../features/system-config/SystemConfigPage"),
  systemUsers: () => import("../features/system-users/SystemUsersPage"),
  skillHub: () => import("../features/skill-hub/SkillHubPage"),
} as const;

const adminRouteLoaders: Record<string, () => Promise<unknown>> = {
  "/playground": routeLoaders.playground,
  "/egress-proxies": routeLoaders.egressProxies,
  "/hosts": routeLoaders.hosts,
  "/knowledges": routeLoaders.knowledges,
  "/work-projects": routeLoaders.workProjects,
  "/work-projects/:projectId": routeLoaders.workProjectWorkspace,
  "/sandbox-images": routeLoaders.sandboxImages,
  "/sandbox-containers": routeLoaders.sandboxContainers,
  "/toolpack": routeLoaders.toolpack,
  "/system-config": routeLoaders.systemConfig,
  "/system-users": routeLoaders.systemUsers,
  "/skill-hub": routeLoaders.skillHub,
};

const preloadedRoutes = new Set<string>();
const ROUTE_PRELOAD_START_DELAY_MS = 2500;
const ROUTE_PRELOAD_FALLBACK_DELAY_MS = 650;
const ROUTE_PRELOAD_INPUT_RETRY_MS = 400;

const relatedRoutePreloads: Record<string, readonly string[]> = {
  "/playground": ["/work-projects", "/toolpack"],
  "/work-projects": ["/work-projects/:projectId", "/playground"],
  "/work-projects/:projectId": ["/work-projects", "/playground"],
  "/knowledges": ["/work-projects", "/playground"],
  "/hosts": ["/sandbox-containers", "/playground"],
  "/egress-proxies": ["/sandbox-containers", "/playground"],
  "/sandbox-images": ["/sandbox-containers", "/playground"],
  "/sandbox-containers": ["/sandbox-images", "/hosts"],
  "/toolpack": ["/sandbox-containers", "/playground"],
  "/system-config": ["/playground", "/system-users"],
  "/system-users": ["/system-config", "/playground"],
  "/skill-hub": ["/system-config", "/playground"],
};

export const loadProtectedAdminShell = routeLoaders.protectedAdminShell;
export const loadEgressProxiesPage = routeLoaders.egressProxies;
export const loadHostsPage = routeLoaders.hosts;
export const loadKnowledgesPage = routeLoaders.knowledges;
export const loadPlaygroundPage = routeLoaders.playground;
export const loadWorkProjectsPage = routeLoaders.workProjects;
export const loadWorkProjectWorkspacePage = routeLoaders.workProjectWorkspace;
export const loadSandboxImagesPage = routeLoaders.sandboxImages;
export const loadSandboxContainersPage = routeLoaders.sandboxContainers;
export const loadToolpackPage = routeLoaders.toolpack;
export const loadSystemConfigPage = routeLoaders.systemConfig;
export const loadSystemUsersPage = routeLoaders.systemUsers;
export const loadSkillHubPage = routeLoaders.skillHub;

export function preloadAdminRoute(path: string): Promise<void> | null {
  const loader = adminRouteLoaders[path];
  if (!loader || preloadedRoutes.has(path)) return null;
  preloadedRoutes.add(path);
  return loader()
    .then(() => undefined)
    .catch(() => {
      preloadedRoutes.delete(path);
    });
}

export function scheduleAdminRoutePreloads(activePath: string): () => void {
  if (!allowsBackgroundPreload()) return () => undefined;

  const idleScheduler = window as unknown as {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const scheduling = navigator as Navigator & {
    scheduling?: {
      isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
    };
  };
  const normalizedActivePath = normalizeAdminRoutePath(activePath);
  const queue = [...(relatedRoutePreloads[normalizedActivePath] ?? ["/playground"])]
    .filter((path) => path !== normalizedActivePath);
  let cancelled = false;
  let startTimer: number | null = null;
  let fallbackTimer: number | null = null;
  let idleCallback: number | null = null;
  let waitingForVisibility = false;

  const scheduleNext = () => {
    if (cancelled || queue.length === 0) return;
    if (document.visibilityState !== "visible") {
      if (!waitingForVisibility) {
        waitingForVisibility = true;
        document.addEventListener("visibilitychange", resumeWhenVisible);
      }
      return;
    }
    if (typeof idleScheduler.requestIdleCallback === "function") {
      idleCallback = idleScheduler.requestIdleCallback(runNext, { timeout: 4000 });
      return;
    }
    fallbackTimer = window.setTimeout(runNext, ROUTE_PRELOAD_FALLBACK_DELAY_MS);
  };

  const resumeWhenVisible = () => {
    if (document.visibilityState !== "visible") return;
    waitingForVisibility = false;
    document.removeEventListener("visibilitychange", resumeWhenVisible);
    scheduleNext();
  };

  const runNext = () => {
    idleCallback = null;
    fallbackTimer = null;
    if (cancelled) return;
    if (document.visibilityState !== "visible") {
      scheduleNext();
      return;
    }
    if (
      scheduling.scheduling?.isInputPending?.({ includeContinuous: true })
    ) {
      fallbackTimer = window.setTimeout(scheduleNext, ROUTE_PRELOAD_INPUT_RETRY_MS);
      return;
    }
    const path = queue.shift();
    if (!path) return;
    const request = preloadAdminRoute(path);
    if (request) {
      void request.finally(scheduleNext);
    } else {
      scheduleNext();
    }
  };

  startTimer = window.setTimeout(() => {
    startTimer = null;
    scheduleNext();
  }, ROUTE_PRELOAD_START_DELAY_MS);

  return () => {
    cancelled = true;
    if (startTimer != null) window.clearTimeout(startTimer);
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
    if (idleCallback != null && typeof idleScheduler.cancelIdleCallback === "function") {
      idleScheduler.cancelIdleCallback(idleCallback);
    }
    if (waitingForVisibility) {
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    }
  };
}

function allowsBackgroundPreload(): boolean {
  const connection = (navigator as Navigator & {
    connection?: {
      saveData?: boolean;
      effectiveType?: string;
    };
  }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}

function normalizeAdminRoutePath(path: string): string {
  if (/^\/work-projects\/[^/]+/.test(path)) {
    return "/work-projects/:projectId";
  }
  return path;
}

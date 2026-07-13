const routeLoaders = {
  protectedAdminShell: () => import("./layouts/ProtectedAdminShell"),
  knowledges: () => import("../features/knowledges/KnowledgesPage"),
  playground: () => import("../features/playground/PlaygroundPage"),
  workProjects: () => import("../features/work-projects/WorkProjectsPage"),
  workProjectWorkspace: () => import("../features/work-projects/WorkProjectWorkspacePage"),
  systemUsers: () => import("../features/system-users/SystemUsersPage"),
  systemConfig: () => import("../features/system-config/SystemConfigPage"),
} as const;

const adminRouteLoaders: Record<string, () => Promise<unknown>> = {
  "/playground": routeLoaders.playground,
  "/knowledges": routeLoaders.knowledges,
  "/work-projects": routeLoaders.workProjects,
  "/work-projects/:projectId": routeLoaders.workProjectWorkspace,
  "/system-users": routeLoaders.systemUsers,
  "/system-config": routeLoaders.systemConfig,
};

const preloadedRoutes = new Set<string>();

export const loadProtectedAdminShell = routeLoaders.protectedAdminShell;
export const loadKnowledgesPage = routeLoaders.knowledges;
export const loadPlaygroundPage = routeLoaders.playground;
export const loadWorkProjectsPage = routeLoaders.workProjects;
export const loadWorkProjectWorkspacePage = routeLoaders.workProjectWorkspace;
export const loadSystemUsersPage = routeLoaders.systemUsers;
export const loadSystemConfigPage = routeLoaders.systemConfig;

export function preloadAdminRoute(path: string) {
  const loader = adminRouteLoaders[path];
  if (!loader || preloadedRoutes.has(path)) return;
  preloadedRoutes.add(path);
  void loader().catch(() => preloadedRoutes.delete(path));
}

export function preloadAdminRoutes() {
  for (const path of Object.keys(adminRouteLoaders)) {
    preloadAdminRoute(path);
  }
}

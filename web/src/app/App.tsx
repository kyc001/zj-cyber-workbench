import { lazy, Suspense, type ComponentType } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useOutletContext,
} from "react-router-dom";
import { AuthProvider, useAuth } from "../shared/auth/AuthProvider";
import { AppErrorBoundary, AppRouteErrorBoundary } from "./AppErrorBoundary";
import {
  loadEgressProxiesPage,
  loadHostsPage,
  loadKnowledgesPage,
  loadPlaygroundPage,
  loadProtectedAdminShell,
  loadSandboxContainersPage,
  loadSandboxImagesPage,
  loadSystemConfigPage,
  loadSystemUsersPage,
  loadSkillHubPage,
  loadToolpackPage,
  loadWorkProjectWorkspacePage,
  loadWorkProjectsPage,
} from "./routePreload";
import { LoginPage } from "../features/auth/LoginPage";

function lazyRoute<TModule extends Record<TKey, ComponentType>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  key: TKey,
) {
  return lazy(() => loader().then((module) => ({ default: module[key] })));
}

const ProtectedAdminShell = lazyRoute(loadProtectedAdminShell, "ProtectedAdminShell");
const EgressProxiesPage = lazyRoute(loadEgressProxiesPage, "EgressProxiesPage");
const HostsPage = lazyRoute(loadHostsPage, "HostsPage");
const KnowledgesPage = lazyRoute(loadKnowledgesPage, "KnowledgesPage");
const PlaygroundPage = lazyRoute(loadPlaygroundPage, "PlaygroundPage");
const WorkProjectWorkspacePage = lazyRoute(loadWorkProjectWorkspacePage, "WorkProjectWorkspacePage");
const SystemConfigPage = lazyRoute(loadSystemConfigPage, "SystemConfigPage");
const WorkProjectsPage = lazyRoute(loadWorkProjectsPage, "WorkProjectsPage");
const SandboxContainersPage = lazyRoute(loadSandboxContainersPage, "SandboxContainersPage");
const SandboxImagesPage = lazyRoute(loadSandboxImagesPage, "SandboxImagesPage");
const ToolpackPage = lazyRoute(loadToolpackPage, "ToolpackPage");
const SkillHubPage = lazyRoute(loadSkillHubPage, "SkillHubPage");
const SystemUsersPage = lazyRoute(loadSystemUsersPage, "SystemUsersPage");

function ProtectedRoute() {
  const { isAuthenticated, ready } = useAuth();
  if (!ready) return <RouteFallback />;
  if (!isAuthenticated) return <LoginPage />;
  return <Outlet />;
}

function AdminOnlyRoute() {
  const outletContext = useOutletContext();
  return <Outlet context={outletContext} />;
}

function HomeRoute() {
  return <Navigate to="/playground" replace />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomeRoute />,
  },
  {
    element: <ProtectedRoute />,
    errorElement: <AppRouteErrorBoundary />,
    children: [
      {
        element: <ProtectedAdminShell />,
        children: [
          { path: "/playground", element: <PlaygroundPage /> },
          {
            element: <AdminOnlyRoute />,
            children: [
              { path: "/hosts", element: <HostsPage /> },
              { path: "/egress-proxies", element: <EgressProxiesPage /> },
              { path: "/knowledges", element: <KnowledgesPage /> },
              { path: "/work-projects", element: <WorkProjectsPage /> },
              { path: "/work-projects/:projectId", element: <WorkProjectWorkspacePage /> },
              { path: "/sandbox-images", element: <SandboxImagesPage /> },
              { path: "/sandbox-containers", element: <SandboxContainersPage /> },
              { path: "/toolpack", element: <ToolpackPage /> },
              { path: "/skill-hub", element: <SkillHubPage /> },
              { path: "/system-users", element: <SystemUsersPage /> },
              { path: "/system-config", element: <SystemConfigPage /> },
            ],
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/playground" replace />,
  },
]);

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<RouteFallback />}>
          <RouterProvider router={router} />
        </Suspense>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

function LocalSessionUnavailable() {
  return (
    <div className="route-fallback">
      <span>无法建立本机工作会话，请确认后端正在运行。</span>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <div className="route-fallback-spinner" aria-hidden="true" />
      <span className="sr-only">正在加载页面</span>
    </div>
  );
}

import { lazy, Suspense, type ComponentType } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useOutletContext } from "react-router-dom";
import { AuthProvider, useAuth } from "../shared/auth/AuthProvider";
import {
  loadEgressProxiesPage,
  loadHostsPage,
  loadKnowledgesPage,
  loadPlaygroundPage,
  loadProtectedAdminShell,
  loadSandboxContainersPage,
  loadSandboxImagesPage,
  loadSystemConfigPage,
  loadToolpackPage,
  loadWorkProjectWorkspacePage,
  loadWorkProjectsPage,
} from "./routePreload";

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

function ProtectedRoute() {
  const { isAuthenticated, ready } = useAuth();
  if (!ready) return <RouteFallback />;
  if (!isAuthenticated) return <LocalSessionUnavailable />;
  return <Outlet />;
}

function AdminOnlyRoute() {
  const { user } = useAuth();
  const outletContext = useOutletContext();
  if (user?.role !== "admin") {
    return <Navigate to="/playground" replace />;
  }
  return <Outlet context={outletContext} />;
}

function HomeRoute() {
  return <Navigate to="/playground" replace />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<ProtectedAdminShell />}>
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route element={<AdminOnlyRoute />}>
                  <Route path="/hosts" element={<HostsPage />} />
                  <Route path="/egress-proxies" element={<EgressProxiesPage />} />
                  <Route path="/knowledges" element={<KnowledgesPage />} />
                  <Route path="/work-projects" element={<WorkProjectsPage />} />
                  <Route path="/work-projects/:projectId" element={<WorkProjectWorkspacePage />} />
                  <Route path="/sandbox-images" element={<SandboxImagesPage />} />
                  <Route path="/sandbox-containers" element={<SandboxContainersPage />} />
                  <Route path="/toolpack" element={<ToolpackPage />} />
                  <Route path="/system-config" element={<SystemConfigPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/playground" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
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
    <div className="route-fallback">
      <div className="route-fallback-spinner" />
    </div>
  );
}

import { Avatar, Button } from "@douyinfe/semi-ui";
import { BookOpenText, Box, Boxes, Eye, FolderKanban, MessageSquareCode, Network, Server, Settings } from "lucide-react";
import { ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { SessionList } from "../../features/playground/SessionList";
import { RuntimePermissionControl } from "../../features/permissions/RuntimePermissionControl";
import { useAgentSessionContext } from "../../features/playground/AgentSessionProvider";
import { useAuth } from "../../shared/auth/AuthProvider";
import { cx } from "../../shared/lib/className";
import { preloadAdminRoute, preloadAdminRoutes } from "../routePreload";

type AdminLayoutContext = {
  setHeaderActions: (actions: ReactNode) => void;
  refreshWorkProjects: () => void;
};

export function useAdminHeaderActions() {
  return useOutletContext<AdminLayoutContext>().setHeaderActions;
}

export function useRefreshWorkProjects() {
  return useOutletContext<AdminLayoutContext>().refreshWorkProjects;
}

const navItems = [
  { path: "/playground", label: "智能体工作台", eyebrow: "对话与任务执行", icon: MessageSquareCode },
  { path: "/work-projects", label: "工作项目", eyebrow: "项目与资产管理", icon: FolderKanban, adminOnly: true },
  { path: "/knowledges", label: "知识库", eyebrow: "检索与知识图谱", icon: BookOpenText, adminOnly: true },
  { path: "/hosts", label: "主机管理", eyebrow: "本机与 SSH 目标", icon: Server, adminOnly: true },
  { path: "/egress-proxies", label: "出口代理", eyebrow: "网络出口配置", icon: Network, adminOnly: true },
  { path: "/sandbox-images", label: "工具基线", eyebrow: "便携工具配置", icon: Boxes, adminOnly: true },
  { path: "/sandbox-containers", label: "执行工作区", eyebrow: "本机运行实例", icon: Box, adminOnly: true },
  { path: "/system-config", label: "系统配置", eyebrow: "运行时与模型配置", icon: Settings, adminOnly: true },
];

export function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [headerActions, setHeaderActionsState] = useState<ReactNode>(null);
  const [projectListVersion, setProjectListVersion] = useState(0);
  const {
    sessions,
    sessionsLoading,
    activeSessionId,
    selectSession,
    deleteSession,
    refreshSessions,
    dropSessionRuntime,
    syncSessionSummaries,
  } = useAgentSessionContext();

  const setHeaderActions = useCallback((actions: ReactNode) => {
    setHeaderActionsState((current) => (Object.is(current, actions) ? current : actions));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(preloadAdminRoutes, 300);
    return () => window.clearTimeout(id);
  }, []);

  const refreshWorkProjects = useCallback(() => {
    setProjectListVersion((version) => version + 1);
  }, []);

  const handleSelectAgentSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
    if (!location.pathname.startsWith("/playground")) {
      navigate("/playground");
    }
  }, [location.pathname, navigate, selectSession]);

  const outletContext = useMemo<AdminLayoutContext>(
    () => ({ setHeaderActions, refreshWorkProjects }),
    [refreshWorkProjects, setHeaderActions],
  );

  const isAdmin = user?.role === "admin";
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);
  const activeItem = visibleNavItems.find((item) => location.pathname.startsWith(item.path));
  const contentMode = location.pathname.startsWith("/playground") ? "fixed" : "scroll";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-lockup">
          <Eye className="brand-logo" aria-hidden="true" />
          <div>
            <div className="brand-name">ZJ</div>
            <div className="brand-kicker">网络安全协作工作台</div>
          </div>
        </div>

        <div className="admin-sidebar-body">
          <div className="admin-sidebar-top">
            <NavLink
              to="/playground"
              className="admin-nav-link"
              onFocus={() => preloadAdminRoute("/playground")}
              onPointerDown={() => preloadAdminRoute("/playground")}
              onPointerEnter={() => preloadAdminRoute("/playground")}
            >
              <MessageSquareCode size={18} />
              <span>智能体工作台</span>
            </NavLink>
            <div className="admin-sidebar-secondary">
              <SessionList
                sessions={sessions}
                loading={sessionsLoading}
                activeSessionId={activeSessionId}
                projectListVersion={projectListVersion}
                onSelect={handleSelectAgentSession}
                onDelete={deleteSession}
                onRefreshSessions={refreshSessions}
                onDropRuntime={dropSessionRuntime}
                onSyncSessionSummaries={syncSessionSummaries}
              />
            </div>
          </div>

          <nav className="admin-nav admin-nav-bottom" aria-label="主导航">
            {visibleNavItems.slice(1).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className="admin-nav-link"
                  onFocus={() => preloadAdminRoute(item.path)}
                  onPointerDown={() => preloadAdminRoute(item.path)}
                  onPointerEnter={() => preloadAdminRoute(item.path)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <div className="page-eyebrow">{activeItem?.eyebrow || "运行管理"}</div>
            <h1>{activeItem?.label || "控制台"}</h1>
          </div>
          <div className="topbar-actions">
            {headerActions ? <div className="topbar-resource-actions">{headerActions}</div> : null}
            <div className="topbar-session-actions">
              <RuntimePermissionControl />
              <Avatar size="small" color="red">{user?.username?.[0]?.toUpperCase() || "U"}</Avatar>
            </div>
          </div>
        </header>
        <main className="admin-content">
          <div className={cx("admin-content-viewport", `admin-content-viewport-${contentMode}`)}>
            <div className={cx("admin-route", `admin-route-${contentMode}`)}>
              <Suspense fallback={<AdminRouteFallback />}>
                <Outlet context={outletContext} />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function AdminRouteFallback() {
  return (
    <div className="admin-route-fallback">
      <div className="route-fallback-spinner" />
    </div>
  );
}

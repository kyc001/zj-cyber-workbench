import { Avatar, SideSheet } from "@douyinfe/semi-ui";
import { BookOpenText, Box, Boxes, Eye, FolderKanban, MessageCircleMore, MessageSquareCode, Network, Server, Settings, Users, Wrench } from "lucide-react";
import { ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { SessionList } from "../../features/playground/SessionList";
import { RuntimePermissionControl } from "../../features/permissions/RuntimePermissionControl";
import { useAgentSessionContext } from "../../features/playground/AgentSessionProvider";
import { useAuth } from "../../shared/auth/AuthProvider";
import { cx } from "../../shared/lib/className";
import { preloadAdminRoute, scheduleAdminRoutePreloads } from "../routePreload";

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
  { path: "/toolpack", label: "Toolpack", eyebrow: "工具执行入口", icon: Wrench, adminOnly: true },
  { path: "/skill-hub", label: "Skill Hub", eyebrow: "社区技能市场", icon: Boxes, adminOnly: true },
  { path: "/system-config", label: "系统配置", eyebrow: "运行时与模型配置", icon: Settings, adminOnly: true },
  { path: "/system-users", label: "用户管理", eyebrow: "账号与角色管理", icon: Users, adminOnly: true },
];

const MOBILE_LAYOUT_QUERY = "(max-width: 900px)";

export function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [headerActions, setHeaderActionsState] = useState<ReactNode>(null);
  const [projectListVersion, setProjectListVersion] = useState(0);
  const [mobileLayout, setMobileLayout] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  ));
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const activeNavRef = useRef<HTMLAnchorElement | null>(null);
  const {
    sessions,
    sessionsLoading,
    sessionsError,
    deletingSessionIds,
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
    return scheduleAdminRoutePreloads(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const sync = () => setMobileLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMobileSessionsOpen(false);
  }, [location.pathname, mobileLayout]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      activeNavRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  const refreshWorkProjects = useCallback(() => {
    setProjectListVersion((version) => version + 1);
  }, []);

  const handleSelectAgentSession = useCallback((sessionId: string) => {
    setMobileSessionsOpen(false);
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
  const sessionList = (
    <SessionList
      sessions={sessions}
      loading={sessionsLoading}
      error={sessionsError}
      activeSessionId={activeSessionId}
      deletingSessionIds={deletingSessionIds}
      projectListVersion={projectListVersion}
      onSelect={handleSelectAgentSession}
      onDelete={deleteSession}
      onRefreshSessions={refreshSessions}
      onDropRuntime={dropSessionRuntime}
      onClearSelection={() => selectSession(null)}
      onSyncSessionSummaries={syncSessionSummaries}
    />
  );

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
              ref={location.pathname.startsWith("/playground") ? activeNavRef : undefined}
              className="admin-nav-link"
              aria-label="智能体工作台"
              title="智能体工作台"
              onFocus={() => void preloadAdminRoute("/playground")}
              onPointerDown={() => void preloadAdminRoute("/playground")}
              onPointerEnter={() => void preloadAdminRoute("/playground")}
            >
              <MessageSquareCode size={18} />
              <span>智能体工作台</span>
            </NavLink>
            {!mobileLayout ? <div className="admin-sidebar-secondary">{sessionList}</div> : null}
          </div>

          {mobileLayout ? (
            <button
              type="button"
              className="admin-mobile-session-trigger"
              aria-label={`打开会话列表，共 ${sessions.length} 个普通会话`}
              aria-haspopup="dialog"
              aria-expanded={mobileSessionsOpen}
              onClick={() => setMobileSessionsOpen(true)}
            >
              <MessageCircleMore size={18} aria-hidden="true" />
              <span className="admin-mobile-session-label">会话</span>
              <span className="admin-mobile-session-count" aria-hidden="true">
                {sessions.length > 99 ? "99+" : sessions.length}
              </span>
            </button>
          ) : null}

          <nav className="admin-nav admin-nav-bottom" aria-label="主导航">
            {visibleNavItems.slice(1).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  ref={location.pathname.startsWith(item.path) ? activeNavRef : undefined}
                  className="admin-nav-link"
                  aria-label={item.label}
                  title={item.label}
                  onFocus={() => void preloadAdminRoute(item.path)}
                  onPointerDown={() => void preloadAdminRoute(item.path)}
                  onPointerEnter={() => void preloadAdminRoute(item.path)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      {mobileLayout ? (
        <SideSheet
          className="admin-mobile-session-sheet"
          visible={mobileSessionsOpen}
          placement="left"
          width="min(360px, calc(100vw - 32px))"
          title={(
            <span className="admin-mobile-session-sheet-title">
              <MessageCircleMore size={19} aria-hidden="true" />
              <span>会话与项目</span>
            </span>
          )}
          footer={null}
          maskClosable
          closeOnEsc
          keepDOM
          aria-label="会话与项目"
          bodyStyle={{ padding: 0, overflow: "hidden" }}
          onCancel={() => setMobileSessionsOpen(false)}
        >
          {sessionList}
        </SideSheet>
      ) : null}

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
    <div className="admin-route-fallback" role="status" aria-live="polite">
      <div className="route-fallback-spinner" aria-hidden="true" />
      <span className="sr-only">正在加载页面内容</span>
    </div>
  );
}

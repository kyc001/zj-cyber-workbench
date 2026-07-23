import { Button, Input, Modal, Popconfirm, Spin } from "@douyinfe/semi-ui";
import {
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Edit3,
  FolderKanban,
  Info,
  LoaderCircle,
  MessageCircle,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  KeyboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { updateAgentSessionTitle } from "../../shared/api/agentSessions";
import { getApiErrorMessage } from "../../shared/api/feedback";
import {
  createWorkProjectSession,
  deleteWorkProjectSession,
  listWorkProjectSessions,
  queryWorkProjects,
} from "../../shared/api/workProjects";
import type { AgentSessionSummary, WorkProject } from "../../shared/api/types";
import { useResourceSubmit } from "../../shared/hooks/useResourceSubmit";
import { cx } from "../../shared/lib/className";
import { UI_TEXT } from "../../shared/lib/uiText";
import { DeferredWorkProjectInfoModal } from "../work-projects/DeferredWorkProjectInfoModal";

const PROJECT_REFRESH_INTERVAL_MS = 15000;

type SessionListProps = {
  sessions: AgentSessionSummary[];
  loading: boolean;
  error: string;
  activeSessionId: string | null;
  deletingSessionIds: ReadonlySet<string>;
  projectListVersion: number;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRefreshSessions: (silent?: boolean) => Promise<void>;
  onDropRuntime: (sessionId: string) => void;
  onClearSelection: () => void;
  onSyncSessionSummaries: (items: AgentSessionSummary[]) => void;
};

type ProjectSessionState = {
  loading: boolean;
  items: AgentSessionSummary[];
  error: string;
};

type ChatSessionRowProps = {
  session: AgentSessionSummary;
  active: boolean;
  activeRowRef: RefObject<HTMLDivElement | null>;
  actionsDisabled: boolean;
  deleting: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (session: AgentSessionSummary) => void;
};

type SessionRowProps = {
  active: boolean;
  actionsDisabled?: boolean;
  className?: string;
  deleting?: boolean;
  deleteConfirm?: {
    title: string;
    content: string;
    onConfirm: () => void;
  };
  icon: ReactNode;
  session: AgentSessionSummary;
  titleFallback: string;
  activeRowRef?: RefObject<HTMLDivElement | null>;
  onRename: () => void;
  onSelect: () => void;
};

type ProjectGroupProps = {
  project: WorkProject;
  state?: ProjectSessionState;
  expanded: boolean;
  actionBusy: boolean;
  creating: boolean;
  deletingSessionId: string | null;
  activeSessionId: string | null;
  activeRowRef: RefObject<HTMLDivElement | null>;
  onToggle: (projectId: number) => void;
  onShowInfo: (project: WorkProject) => void;
  onCreateSession: (project: WorkProject) => void;
  onRetrySessions: (projectId: number) => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: AgentSessionSummary, projectId: number) => void;
  onDeleteSession: (projectId: number, sessionId: string) => void;
};

type RenameTarget = {
  session: AgentSessionSummary;
  projectId?: number;
};

type PendingListAction =
  | { type: "create"; projectId: number }
  | { type: "delete"; projectId: number; sessionId: string }
  | { type: "rename"; sessionId: string };

export function SessionList({
  sessions,
  loading,
  error,
  activeSessionId,
  deletingSessionIds,
  projectListVersion,
  onSelect,
  onDelete,
  onRefreshSessions,
  onDropRuntime,
  onClearSelection,
  onSyncSessionSummaries,
}: SessionListProps) {
  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [projectSessions, setProjectSessions] = useState<Map<number, ProjectSessionState>>(() => new Map());
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoProjectId, setInfoProjectId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [filter, setFilter] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingListAction | null>(null);
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const projectsRequestRef = useRef(0);
  const projectSessionRequestsRef = useRef<Map<number, number>>(new Map());
  const pendingActionRef = useRef<PendingListAction | null>(null);
  const { submit } = useResourceSubmit();
  const renaming = pendingAction?.type === "rename";
  const normalizedFilter = filter.trim().toLocaleLowerCase();

  const runSubmit = useCallback(async (
    action: PendingListAction,
    task: Parameters<typeof submit>[0],
  ) => {
    if (pendingActionRef.current) return;
    pendingActionRef.current = action;
    setPendingAction(action);
    try {
      await submit(task);
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, [submit]);

  const loadProjects = useCallback(async (silent = false) => {
    const requestId = projectsRequestRef.current + 1;
    projectsRequestRef.current = requestId;
    if (!silent) {
      setProjectsLoading(true);
      setProjectsError("");
    }
    try {
      const response = await queryWorkProjects({ page: 1, size: 100, keyword: "" });
      if (projectsRequestRef.current !== requestId) return;
      setProjects(response.data?.items ?? []);
      setProjectsError("");
    } catch (error) {
      if (projectsRequestRef.current === requestId && !silent) {
        setProjectsError(getApiErrorMessage(error, "加载项目列表失败"));
      }
    } finally {
      if (projectsRequestRef.current === requestId) setProjectsLoading(false);
    }
  }, []);

  const loadProjectSessions = useCallback(async (projectId: number, silent = false) => {
    const requestId = (projectSessionRequestsRef.current.get(projectId) ?? 0) + 1;
    projectSessionRequestsRef.current.set(projectId, requestId);
    if (!silent) {
      setProjectSessions((prev) => new Map(prev).set(projectId, {
        loading: true,
        items: prev.get(projectId)?.items ?? [],
        error: "",
      }));
    }
    try {
      const response = await listWorkProjectSessions(projectId);
      if (projectSessionRequestsRef.current.get(projectId) !== requestId) return;
      const items = response.data?.items ?? [];
      setProjectSessions((prev) => new Map(prev).set(projectId, {
        loading: false,
        items,
        error: "",
      }));
      onSyncSessionSummaries(items);
    } catch (error) {
      if (projectSessionRequestsRef.current.get(projectId) !== requestId) return;
      setProjectSessions((prev) => new Map(prev).set(projectId, {
        loading: false,
        items: prev.get(projectId)?.items ?? [],
        error: silent && (prev.get(projectId)?.items.length ?? 0) > 0
          ? prev.get(projectId)?.error ?? ""
          : getApiErrorMessage(error, "加载项目会话失败"),
      }));
    }
  }, [onSyncSessionSummaries]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, projectListVersion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void onRefreshSessions(true);
      void loadProjects(true);
      if (expandedProjectId !== null) void loadProjectSessions(expandedProjectId, true);
    }, PROJECT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [expandedProjectId, loadProjectSessions, loadProjects, onRefreshSessions]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionId, expandedProjectId, normalizedFilter]);

  const toggleProject = (projectId: number) => {
    const nextProjectId = expandedProjectId === projectId ? null : projectId;
    setExpandedProjectId(nextProjectId);
    if (nextProjectId !== null) void loadProjectSessions(nextProjectId);
  };

  const createProjectSession = async (project: WorkProject) => {
    await runSubmit({ type: "create", projectId: project.id }, async () => {
      const response = await createWorkProjectSession(project.id);
      const sessionId = response.data?.session_id;
      if (!sessionId) return response;
      await loadProjectSessions(project.id);
      onSelect(sessionId);
      return response;
    });
  };

  const deleteProjectSession = async (projectId: number, sessionId: string) => {
    await runSubmit({ type: "delete", projectId, sessionId }, async () => {
      const response = await deleteWorkProjectSession(projectId, sessionId);
      if (activeSessionId === sessionId) onClearSelection();
      onDropRuntime(sessionId);
      await loadProjectSessions(projectId);
      return response;
    });
  };

  const openRename = (target: RenameTarget) => {
    if (pendingActionRef.current) return;
    setRenameTarget(target);
    setRenameTitle(target.session.title || "");
  };

  const saveRename = async () => {
    const title = renameTitle.trim();
    if (!renameTarget || !title) return;
    await runSubmit({ type: "rename", sessionId: renameTarget.session.session_id }, async () => {
      const response = await updateAgentSessionTitle(renameTarget.session.session_id, { title });
      setRenameTarget(null);
      setRenameTitle("");
      if (renameTarget.projectId) {
        await loadProjectSessions(renameTarget.projectId, true);
      } else {
        await onRefreshSessions();
      }
      return response;
    });
  };

  const showProjectInfo = (project: WorkProject) => {
    setInfoProjectId(project.id);
    setInfoOpen(true);
  };

  const hasListError = Boolean(error || projectsError);
  const empty = sessions.length === 0
    && projects.length === 0
    && !loading
    && !projectsLoading
    && !hasListError;

  const retryLists = () => {
    if (error) void onRefreshSessions();
    if (projectsError) void loadProjects();
  };

  const visibleSessions = useMemo(
    () => normalizedFilter
      ? sessions.filter((session) => matchesSessionFilter(session, normalizedFilter))
      : sessions,
    [normalizedFilter, sessions],
  );
  const visibleProjects = useMemo(
    () => normalizedFilter
      ? projects.filter((project) => project.name.toLocaleLowerCase().includes(normalizedFilter))
      : projects,
    [normalizedFilter, projects],
  );
  const resultCount = visibleSessions.length + visibleProjects.length;
  const noFilterResults = Boolean(normalizedFilter)
    && resultCount === 0
    && !loading
    && !projectsLoading;

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(".session-row-main")) return;
    const rows = Array.from(
      listBodyRef.current?.querySelectorAll<HTMLButtonElement>(".session-row-main:not(:disabled)") ?? [],
    );
    const currentIndex = rows.indexOf(target as HTMLButtonElement);
    if (currentIndex < 0 || rows.length === 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, currentIndex + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = rows.length - 1;
    if (nextIndex === currentIndex && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    rows[nextIndex]?.focus();
  };

  return (
    <div className="session-list">
      <div className="session-list-toolbar">
        <Input
          className="session-list-search"
          prefix={<Search size={14} aria-hidden="true" />}
          value={filter}
          showClear
          aria-label="筛选当前会话和项目"
          placeholder="筛选会话和项目"
          onChange={setFilter}
          onClear={() => setFilter("")}
        />
        <Button
          className="session-list-refresh"
          icon={<RefreshCw size={14} />}
          theme="borderless"
          type="tertiary"
          size="small"
          loading={loading || projectsLoading}
          disabled={loading || projectsLoading}
          aria-label="刷新会话和项目列表"
          title="刷新列表"
          onClick={() => {
            void onRefreshSessions();
            void loadProjects();
            if (expandedProjectId !== null) void loadProjectSessions(expandedProjectId);
          }}
        />
      </div>
      {normalizedFilter ? (
        <div className="session-list-filter-status" role="status" aria-live="polite">
          找到 {resultCount} 项
        </div>
      ) : null}
      <div ref={listBodyRef} className="session-list-body" onKeyDown={handleListKeyDown}>
        <Spin spinning={loading || projectsLoading} wrapperClassName="session-list-spin">
          {hasListError && !loading && !projectsLoading ? (
            <div className="session-list-error" role="alert">
              <CircleAlert size={15} aria-hidden="true" />
              <span>
                {error && projectsError
                  ? "会话与项目列表加载失败"
                  : error
                    ? "普通会话加载失败"
                    : "项目列表加载失败"}
              </span>
              <Button
                icon={<RefreshCw size={13} />}
                theme="borderless"
                type="tertiary"
                size="small"
                aria-label="重新加载会话列表"
                title={[error, projectsError].filter(Boolean).join("；")}
                onClick={retryLists}
              />
            </div>
          ) : null}
          {noFilterResults ? (
            <div className="session-empty session-filter-empty">
              <Search size={26} aria-hidden="true" />
              <p>没有匹配“{filter.trim()}”的结果</p>
              <Button size="small" theme="borderless" type="primary" onClick={() => setFilter("")}>
                清除筛选
              </Button>
            </div>
          ) : empty ? (
            <div className="session-empty">
              <MessageCircle size={28} />
              <p>暂无对话。</p>
            </div>
          ) : (
            <>
              {visibleSessions.map((session) => (
                <ChatSessionRow
                  key={session.session_id}
                  session={session}
                  active={session.session_id === activeSessionId}
                  activeRowRef={activeRowRef}
                  actionsDisabled={pendingAction !== null}
                  deleting={deletingSessionIds.has(session.session_id)}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onRename={(targetSession) => openRename({ session: targetSession })}
                />
              ))}
              {visibleProjects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  state={projectSessions.get(project.id)}
                  expanded={expandedProjectId === project.id}
                  actionBusy={pendingAction !== null}
                  creating={pendingAction?.type === "create" && pendingAction.projectId === project.id}
                  deletingSessionId={pendingAction?.type === "delete" && pendingAction.projectId === project.id
                    ? pendingAction.sessionId
                    : null}
                  activeSessionId={activeSessionId}
                  activeRowRef={activeRowRef}
                  onToggle={toggleProject}
                  onShowInfo={showProjectInfo}
                  onCreateSession={(targetProject) => void createProjectSession(targetProject)}
                  onRetrySessions={(projectId) => void loadProjectSessions(projectId)}
                  onSelectSession={onSelect}
                  onRenameSession={(targetSession, projectId) => openRename({ session: targetSession, projectId })}
                  onDeleteSession={(projectId, sessionId) => void deleteProjectSession(projectId, sessionId)}
                />
              ))}
            </>
          )}
        </Spin>
      </div>
      <DeferredWorkProjectInfoModal
        open={infoOpen}
        projectId={infoProjectId}
        onClose={() => {
          setInfoOpen(false);
          setInfoProjectId(null);
        }}
      />
      <Modal
        visible={Boolean(renameTarget)}
        title="编辑会话标题"
        okText={UI_TEXT.save}
        cancelText={UI_TEXT.cancel}
        confirmLoading={renaming}
        closable={!renaming}
        maskClosable={!renaming}
        cancelButtonProps={{ disabled: renaming }}
        okButtonProps={{ type: "primary", disabled: !renameTitle.trim() }}
        onOk={() => void saveRename()}
        onCancel={() => {
          if (!renaming) setRenameTarget(null);
        }}
      >
        <Input
          autoFocus
          maxLength={80}
          disabled={renaming}
          value={renameTitle}
          onChange={setRenameTitle}
          onEnterPress={() => void saveRename()}
        />
      </Modal>
    </div>
  );
}

function ChatSessionRow({
  session,
  active,
  activeRowRef,
  actionsDisabled,
  deleting,
  onSelect,
  onDelete,
  onRename,
}: ChatSessionRowProps) {
  return (
    <SessionRow
      active={active}
      activeRowRef={active ? activeRowRef : undefined}
      actionsDisabled={actionsDisabled}
      deleting={deleting}
      deleteConfirm={{
        title: "删除对话",
        content: "确定永久删除这段对话吗？",
        onConfirm: () => onDelete(session.session_id),
      }}
      icon={<MessageCircle size={14} />}
      session={session}
      titleFallback="未命名会话"
      onRename={() => onRename(session)}
      onSelect={() => onSelect(session.session_id)}
    />
  );
}

function ProjectGroup({
  project,
  state,
  expanded,
  actionBusy,
  creating,
  deletingSessionId,
  activeSessionId,
  activeRowRef,
  onToggle,
  onShowInfo,
  onCreateSession,
  onRetrySessions,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: ProjectGroupProps) {
  return (
    <div className="session-project-group">
      <div className="session-row session-row-project">
        <button type="button" className="session-row-main" onClick={() => onToggle(project.id)}>
          <span className="session-row-icon">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="session-row-body">
            <span className="session-row-title">{project.name}</span>
          </span>
        </button>
        <Button
          icon={<Info size={14} />}
          theme="borderless"
          type="tertiary"
          size="small"
          aria-label={`查看 ${project.name} 详情`}
          onClick={() => onShowInfo(project)}
        />
        <Button
          icon={<MessageSquarePlus size={14} />}
          theme="borderless"
          type="primary"
          size="small"
          disabled={actionBusy || !project.can_create_session}
          loading={creating}
          aria-label={`为 ${project.name} 创建会话`}
          onClick={() => onCreateSession(project)}
        />
      </div>

      {expanded ? (
        <div className="session-project-children">
          {state?.loading ? <div className="session-project-empty">正在加载会话...</div> : null}
          {!state?.loading && state?.error ? (
            <button
              type="button"
              className="session-project-empty session-project-error"
              title={state.error}
              onClick={() => onRetrySessions(project.id)}
            >
              <RefreshCw size={14} />
              <span>加载失败，点击重试</span>
            </button>
          ) : null}
          {!state?.loading && !state?.error && (!state || state.items.length === 0) ? (
            <button
              type="button"
              className="session-project-empty"
              disabled={actionBusy || !project.can_create_session}
              onClick={() => onCreateSession(project)}
            >
              <FolderKanban size={14} />
              <span>新建项目会话</span>
            </button>
          ) : null}
          {state?.items.map((session) => (
            <ProjectSessionRow
              key={session.session_id}
              session={session}
              projectId={project.id}
              active={session.session_id === activeSessionId}
              activeRowRef={activeRowRef}
              actionsDisabled={actionBusy}
              deleting={deletingSessionId === session.session_id}
              onSelect={onSelectSession}
              onRename={onRenameSession}
              onDelete={onDeleteSession}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectSessionRow({
  session,
  projectId,
  active,
  activeRowRef,
  actionsDisabled,
  deleting,
  onSelect,
  onRename,
  onDelete,
}: {
  session: AgentSessionSummary;
  projectId: number;
  active: boolean;
  activeRowRef: RefObject<HTMLDivElement | null>;
  actionsDisabled: boolean;
  deleting: boolean;
  onSelect: (sessionId: string) => void;
  onRename: (session: AgentSessionSummary, projectId: number) => void;
  onDelete: (projectId: number, sessionId: string) => void;
}) {
  return (
    <SessionRow
      active={active}
      activeRowRef={active ? activeRowRef : undefined}
      actionsDisabled={actionsDisabled}
      className="session-row-project-session"
      deleting={deleting}
      deleteConfirm={{
        title: "删除会话",
        content: "确定永久删除这个项目会话吗？",
        onConfirm: () => onDelete(projectId, session.session_id),
      }}
      icon={<Play size={13} />}
      session={session}
      titleFallback="项目会话"
      onRename={() => onRename(session, projectId)}
      onSelect={() => onSelect(session.session_id)}
    />
  );
}

function SessionRow({
  active,
  activeRowRef,
  actionsDisabled = false,
  className,
  deleteConfirm,
  deleting = false,
  icon,
  session,
  titleFallback,
  onRename,
  onSelect,
}: SessionRowProps) {
  const title = session.title || titleFallback;
  const rowTitle = session.run_error
    ? `${title}：${session.run_error.slice(0, 160)}`
    : title;
  const rowClassName = cx("session-row", className, active && "session-row-active");
  const deleteButton = (
    <Button
      icon={<Trash2 size={14} />}
      theme="borderless"
      type="danger"
      size="small"
      disabled={actionsDisabled || deleting}
      loading={deleting}
      aria-label={`删除 ${session.title || session.session_id}`}
    />
  );

  const updatedAt = formatSessionUpdatedAt(session.updated_at);
  const fullUpdatedAt = formatFullDateTime(session.updated_at);

  return (
    <div ref={activeRowRef} className={rowClassName}>
      <button
        type="button"
        className="session-row-main"
        title={rowTitle}
        disabled={deleting}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="session-row-icon">{icon}</span>
        <span className="session-row-body">
          <span className="session-row-title">{title}</span>
          <span className="session-row-meta" title={fullUpdatedAt}>
            {updatedAt ? <span>{updatedAt}</span> : null}
            <span>{session.message_count} 条消息</span>
          </span>
        </span>
        {session.is_running ? (
          <span className="session-row-state session-row-state-running" title="正在运行" aria-label="正在运行">
            <LoaderCircle size={13} />
          </span>
        ) : session.run_error ? (
          <span className="session-row-state session-row-state-error" title="上次运行失败" aria-label="上次运行失败">
            <CircleAlert size={13} />
          </span>
        ) : null}
      </button>
      <Button
        icon={<Edit3 size={14} />}
        theme="borderless"
        type="tertiary"
        size="small"
        disabled={actionsDisabled || deleting}
        aria-label={`编辑 ${session.title || session.session_id}`}
        onClick={onRename}
      />
      {deleteConfirm ? (
        <Popconfirm {...deleteConfirm} okType="danger" cancelText={UI_TEXT.cancel}>
          {deleteButton}
        </Popconfirm>
      ) : null}
    </div>
  );
}

function matchesSessionFilter(session: AgentSessionSummary, normalizedFilter: string): boolean {
  return [
    session.title,
    session.agent_code,
    session.runtime_agent_code,
    session.session_id,
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedFilter));
}

function parseSessionDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSessionUpdatedAt(value: string): string {
  const date = parseSessionDate(value);
  if (!date) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("zh-CN", sameYear
    ? { month: "numeric", day: "numeric" }
    : { year: "numeric", month: "numeric", day: "numeric" });
}

function formatFullDateTime(value: string): string {
  const date = parseSessionDate(value);
  return date?.toLocaleString("zh-CN", { hour12: false }) ?? "";
}

import { Button, Popconfirm, Toast, Tooltip } from "@douyinfe/semi-ui";
import {
  Activity,
  Box,
  FolderKanban,
  FolderOpen,
  Monitor,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SquareStop,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdminHeaderActions } from "../../app/layouts/AdminLayout";
import { showApiError, showApiSuccess } from "../../shared/api/feedback";
import { SANDBOX_CONTAINER_STATUS } from "../../shared/api/generated/constants";
import {
  canManageSandboxContainer,
  canOpenContainerNoVNC,
  deleteSandboxContainer,
  pauseSandboxContainer,
  queryAvailableSandboxContainers,
  resumeSandboxContainer,
  startSandboxContainer,
  stopSandboxContainer,
} from "../../shared/api/sandboxContainers";
import type { AgentInputPart, SandboxContainer } from "../../shared/api/types";
import { getWorkProjectRecordSnapshot } from "../../shared/api/workProjects";
import { cx } from "../../shared/lib/className";
import { UI_TEXT } from "../../shared/lib/uiText";
import { useContainerShell } from "../container-shell/ContainerShellProvider";
import { WorkProjectInfoModal } from "../work-projects/WorkProjectInfoModal";
import { useAgentSessionContext } from "./AgentSessionProvider";
import { ChatStream } from "./ChatStream";
import { Composer } from "./Composer";
import { MessageScrollPanel } from "./MessageScrollPanel";
import { PlaygroundSandboxCreateModal } from "./PlaygroundSandboxCreateModal";
import { SandboxSelector } from "./SandboxSelector";
import { SubagentSidePanel } from "./SubagentSidePanel";
import { useSubagentPanel } from "./useSubagentPanel";

type PlaygroundLocationState = { sessionId?: string };

type SandboxActionButtonProps = {
  ariaLabel: string;
  disabled: boolean;
  icon: ReactNode;
  loading?: boolean;
  tooltip: string;
  onClick: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  open: "已连接",
  connecting: "连接中",
  closed: "已断开",
  idle: "空闲",
};

export function PlaygroundPage() {
  const setHeaderActions = useAdminHeaderActions();
  const {
    activeSessionId, activeSessionSummary, selectSession,
    refreshSessions,
    chatState, status, historyLoading, historyHasMore, historyPrepending, historyVersion,
    agents, defaultAgentCode, activeAgentCode, setActiveAgentCode,
    send, updateSelectedSandboxContainer, interrupt, cancelAll, loadPreviousHistory,
  } = useAgentSessionContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [availableSandboxContainers, setAvailableSandboxContainers] = useState<SandboxContainer[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxContainerId, setSandboxContainerId] = useState<number | null>(null);
  const [projectSandboxContainerId, setProjectSandboxContainerId] = useState<number | null>(null);
  const [projectSandboxContainer, setProjectSandboxContainer] = useState<SandboxContainer | null>(null);
  const [projectSandboxScopeLoaded, setProjectSandboxScopeLoaded] = useState(false);
  const [projectRecordsOpen, setProjectRecordsOpen] = useState(false);
  const [createSandboxOpen, setCreateSandboxOpen] = useState(false);
  const [sandboxAction, setSandboxAction] = useState<string | null>(null);
  const { openFileManager, openNoVNC, openShell, syncContainerWindows } = useContainerShell();
  const { selectedSubagent, setSelectedSubagent, subagentTabs, closeSubagentPanel } = useSubagentPanel(chatState, activeSessionId);
  const hasRunningSubagents = subagentTabs.some((tab) => tab.status === "running");
  const agentSwitchDisabled = activeAgentCode === defaultAgentCode && hasRunningSubagents;

  const activeProjectId = activeSessionSummary?.session_type === "project" ? activeSessionSummary.project_id ?? null : null;
  const currentProjectSandboxContainer = useMemo(() => {
    if (!activeProjectId) return null;
    if (projectSandboxContainerId === null) return projectSandboxContainer;
    return findSandboxContainerById(availableSandboxContainers, projectSandboxContainerId) ?? projectSandboxContainer;
  }, [activeProjectId, availableSandboxContainers, projectSandboxContainer, projectSandboxContainerId]);
  const selectableSandboxContainers = useMemo(() => {
    if (activeProjectId) return currentProjectSandboxContainer ? [currentProjectSandboxContainer] : [];
    return availableSandboxContainers;
  }, [activeProjectId, availableSandboxContainers, currentProjectSandboxContainer]);
  const selectedSandboxContainer = useMemo(
    () => findSandboxContainerById(selectableSandboxContainers, sandboxContainerId),
    [sandboxContainerId, selectableSandboxContainers],
  );
  const sandboxAccessUnavailableReason = getSandboxAccessUnavailableReason(selectedSandboxContainer);
  const sandboxManageUnavailableReason = sandboxAccessUnavailableReason ? "没有操作此工作区的权限" : null;
  const shellUnavailableReason = sandboxAccessUnavailableReason
    ?? getSandboxActionUnavailableReason(selectedSandboxContainer, {});
  const screenUnavailableReason = sandboxAccessUnavailableReason
    ?? getSandboxActionUnavailableReason(selectedSandboxContainer, { requiresNoVNC: true });
  const selectedSandboxName = selectedSandboxContainer?.container_name ?? "当前工作区";
  const selectedSandboxActionId = selectedSandboxContainer?.id ?? 0;
  const canStartSelectedSandbox = Boolean(!sandboxManageUnavailableReason && selectedSandboxContainer && (
    selectedSandboxContainer.status === SANDBOX_CONTAINER_STATUS.CREATED
    || selectedSandboxContainer.status === SANDBOX_CONTAINER_STATUS.STOPPED
  ));
  const canStopSelectedSandbox = !sandboxManageUnavailableReason
    && selectedSandboxContainer?.status === SANDBOX_CONTAINER_STATUS.RUNNING;
  const canPauseSelectedSandbox = !sandboxManageUnavailableReason
    && selectedSandboxContainer?.status === SANDBOX_CONTAINER_STATUS.RUNNING;
  const canResumeSelectedSandbox = !sandboxManageUnavailableReason
    && selectedSandboxContainer?.status === SANDBOX_CONTAINER_STATUS.PAUSED;
  const openProjectRecords = useCallback(() => {
    setProjectRecordsOpen(true);
  }, []);
  const openSubagentPanel = useCallback(() => {
    const tab = [...subagentTabs].reverse().find((item) => item.status === "running") ?? subagentTabs[subagentTabs.length - 1];
    if (tab) setSelectedSubagent(tab.agentCode);
  }, [setSelectedSubagent, subagentTabs]);

  const openSelectedFileManager = useCallback(() => {
    if (selectedSandboxContainer) openFileManager(selectedSandboxContainer);
  }, [openFileManager, selectedSandboxContainer]);

  const openSelectedShell = useCallback(() => {
    if (selectedSandboxContainer) openShell(selectedSandboxContainer);
  }, [openShell, selectedSandboxContainer]);

  const openSelectedNoVNC = useCallback(() => {
    if (selectedSandboxContainer) openNoVNC(selectedSandboxContainer);
  }, [openNoVNC, selectedSandboxContainer]);

  const loadSandboxes = useCallback(async () => {
    setSandboxLoading(true);
    try {
      const availableResponse = await queryAvailableSandboxContainers({
        page: 1,
        size: 100,
        keyword: "",
        work_project_id: activeProjectId ?? undefined,
        include_non_running: true,
      });
      setAvailableSandboxContainers(availableResponse.data?.items ?? []);
    } catch (error) {
      showApiError(error);
    } finally {
      setSandboxLoading(false);
    }
  }, [activeProjectId]);

  // consume sessionId from navigate state (e.g. project "Go") then clear so
  // back-navigation does not retrigger the jump
  useEffect(() => {
    const incoming = (location.state as PlaygroundLocationState | null)?.sessionId;
    if (incoming) {
      selectSession(incoming);
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.state, navigate, selectSession]);

  useEffect(() => {
    void loadSandboxes();
  }, [loadSandboxes]);

  useEffect(() => {
    if (!activeSessionId) return;
    setSandboxContainerId(activeSessionSummary?.selected_sandbox_container_id ?? null);
  }, [activeSessionId, activeSessionSummary?.selected_sandbox_container_id]);

  useEffect(() => {
    syncContainerWindows(selectedSandboxContainer);
  }, [
    activeSessionId,
    selectedSandboxContainer?.id,
    selectedSandboxContainer?.control_proxy_host_port,
    selectedSandboxContainer?.status,
    syncContainerWindows,
  ]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectSandboxContainerId(null);
      setProjectSandboxContainer(null);
      setProjectSandboxScopeLoaded(false);
      return;
    }
    let active = true;
    setProjectSandboxContainerId(null);
    setProjectSandboxContainer(null);
    setProjectSandboxScopeLoaded(false);
    getWorkProjectRecordSnapshot(activeProjectId)
      .then((response) => {
        if (!active) return;
        const project = response.data?.project;
        const containerId = project?.sandbox_container_id ?? null;
        setProjectSandboxContainerId(containerId);
        setProjectSandboxContainer(project?.sandbox_container ?? null);
        setSandboxContainerId(containerId);
        setProjectSandboxScopeLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setProjectSandboxContainerId(null);
        setProjectSandboxContainer(null);
        setProjectSandboxScopeLoaded(true);
        showApiError(error);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId]);

  const changeSandboxContainer = useCallback(async (nextContainerId: number | null) => {
    const nextContainer = findSandboxContainerById(selectableSandboxContainers, nextContainerId);
    if (!activeSessionId) {
      setSandboxContainerId(nextContainerId);
      syncContainerWindows(nextContainer);
      return;
    }
    try {
      const summary = await updateSelectedSandboxContainer(activeSessionId, nextContainerId);
      const selectedId = summary?.selected_sandbox_container_id ?? null;
      setSandboxContainerId(selectedId);
      syncContainerWindows(findSandboxContainerById(selectableSandboxContainers, selectedId));
    } catch (error) {
      showApiError(error);
    }
  }, [activeSessionId, selectableSandboxContainers, syncContainerWindows, updateSelectedSandboxContainer]);

  const handleSandboxCreated = useCallback((container: SandboxContainer) => {
    setCreateSandboxOpen(false);
    setAvailableSandboxContainers((current) => upsertSandboxContainer(current, container));
    if (!activeProjectId) {
      setSandboxContainerId(container.id);
      syncContainerWindows(container);
    }
    void loadSandboxes();
  }, [activeProjectId, loadSandboxes, syncContainerWindows]);

  const runSandboxMutation = useCallback(async (
    action: "start" | "stop" | "pause" | "resume",
    container: SandboxContainer | null,
  ) => {
    if (!container) return;
    const actionKey = `${action}:${container.id}`;
    setSandboxAction(actionKey);
    try {
      const response = action === "start"
        ? await startSandboxContainer(container.id)
        : action === "stop"
          ? await stopSandboxContainer(container.id)
          : action === "pause"
            ? await pauseSandboxContainer(container.id)
            : await resumeSandboxContainer(container.id);
      showApiSuccess(response);
      const updatedContainer = response.data;
      if (updatedContainer) {
        setAvailableSandboxContainers((current) => upsertSandboxContainer(current, updatedContainer));
        if (updatedContainer.id === projectSandboxContainerId) setProjectSandboxContainer(updatedContainer);
        setSandboxContainerId(updatedContainer.id);
        syncContainerWindows(updatedContainer);
      }
      await loadSandboxes();
    } catch (error) {
      showApiError(error);
    } finally {
      setSandboxAction(null);
    }
  }, [loadSandboxes, projectSandboxContainerId, syncContainerWindows]);

  const deleteSelectedSandboxContainer = useCallback(async () => {
    if (!selectedSandboxContainer) return;
    const actionKey = `delete:${selectedSandboxContainer.id}`;
    setSandboxAction(actionKey);
    try {
      const response = await deleteSandboxContainer(selectedSandboxContainer.id);
      showApiSuccess(response);
      setAvailableSandboxContainers((current) => current.filter((container) => container.id !== selectedSandboxContainer.id));
      if (projectSandboxContainerId === selectedSandboxContainer.id) {
        setProjectSandboxContainerId(null);
        setProjectSandboxContainer(null);
      }
      setSandboxContainerId(null);
      syncContainerWindows(null);
      await Promise.all([loadSandboxes(), refreshSessions()]);
    } catch (error) {
      showApiError(error);
    } finally {
      setSandboxAction(null);
    }
  }, [loadSandboxes, projectSandboxContainerId, refreshSessions, selectedSandboxContainer, syncContainerWindows]);

  useEffect(() => {
    if (activeSessionSummary?.session_type === "project" && projectSandboxScopeLoaded) {
      setSandboxContainerId(projectSandboxContainerId);
    }
  }, [activeSessionSummary?.session_type, projectSandboxContainerId, projectSandboxScopeLoaded]);

  const headerNode = useMemo(() => (
    <>
      <SandboxSelector
        containers={selectableSandboxContainers}
        loading={sandboxLoading}
        value={sandboxContainerId}
        className="sandbox-selector-topbar"
        disabled={Boolean(activeProjectId)}
        onChange={(id) => void changeSandboxContainer(id)}
      />
      <div className="sandbox-container-actions" aria-label="执行工作区操作">
        <SandboxActionButton
          ariaLabel="创建执行工作区"
          disabled={Boolean(activeProjectId)}
          icon={<Box size={15} />}
          tooltip={activeProjectId ? "项目会话使用项目绑定的工作区" : "创建执行工作区"}
          onClick={() => setCreateSandboxOpen(true)}
        />
        <SandboxActionButton
          ariaLabel={`启动${selectedSandboxName}`}
          disabled={!canStartSelectedSandbox}
          icon={<Play size={15} />}
          loading={sandboxAction === `start:${selectedSandboxActionId}`}
          tooltip={sandboxManageUnavailableReason ?? (canStartSelectedSandbox ? `启动${selectedSandboxName}` : "请选择已创建或已停止的工作区")}
          onClick={() => void runSandboxMutation("start", selectedSandboxContainer)}
        />
        <SandboxActionButton
          ariaLabel={`停止${selectedSandboxName}`}
          disabled={!canStopSelectedSandbox}
          icon={<SquareStop size={15} />}
          loading={sandboxAction === `stop:${selectedSandboxActionId}`}
          tooltip={sandboxManageUnavailableReason ?? (canStopSelectedSandbox ? `停止${selectedSandboxName}` : "请选择运行中的工作区")}
          onClick={() => void runSandboxMutation("stop", selectedSandboxContainer)}
        />
        <SandboxActionButton
          ariaLabel={`暂停${selectedSandboxName}`}
          disabled={!canPauseSelectedSandbox}
          icon={<Pause size={15} />}
          loading={sandboxAction === `pause:${selectedSandboxActionId}`}
          tooltip={sandboxManageUnavailableReason ?? (canPauseSelectedSandbox ? `暂停${selectedSandboxName}` : "请选择运行中的工作区")}
          onClick={() => void runSandboxMutation("pause", selectedSandboxContainer)}
        />
        <SandboxActionButton
          ariaLabel={`恢复${selectedSandboxName}`}
          disabled={!canResumeSelectedSandbox}
          icon={<RotateCcw size={15} />}
          loading={sandboxAction === `resume:${selectedSandboxActionId}`}
          tooltip={sandboxManageUnavailableReason ?? (canResumeSelectedSandbox ? `恢复${selectedSandboxName}` : "请选择已暂停的工作区")}
          onClick={() => void runSandboxMutation("resume", selectedSandboxContainer)}
        />
        <Popconfirm
          title="删除执行工作区"
          content={selectedSandboxContainer ? `确定删除${selectedSandboxContainer.container_name}？` : "请先选择工作区"}
          okType="danger"
          cancelText={UI_TEXT.cancel}
          onConfirm={() => void deleteSelectedSandboxContainer()}
        >
          <span>
            <SandboxActionButton
              ariaLabel={`删除${selectedSandboxName}`}
              disabled={!selectedSandboxContainer || Boolean(sandboxManageUnavailableReason)}
              icon={<Trash2 size={15} />}
              loading={sandboxAction === `delete:${selectedSandboxActionId}`}
              tooltip={sandboxManageUnavailableReason ?? (selectedSandboxContainer ? `删除${selectedSandboxName}` : "请先选择工作区")}
              onClick={() => undefined}
            />
          </span>
        </Popconfirm>
        <SandboxActionButton
          ariaLabel={`打开${selectedSandboxName}终端`}
          disabled={Boolean(shellUnavailableReason)}
          icon={<SquareTerminal size={15} />}
          tooltip={shellUnavailableReason ?? `打开${selectedSandboxName}终端`}
          onClick={openSelectedShell}
        />
        <SandboxActionButton
          ariaLabel={`打开${selectedSandboxName}桌面`}
          disabled={Boolean(screenUnavailableReason)}
          icon={<Monitor size={15} />}
          tooltip={screenUnavailableReason ?? `打开${selectedSandboxName}桌面`}
          onClick={openSelectedNoVNC}
        />
        <SandboxActionButton
          ariaLabel={`浏览${selectedSandboxName}文件`}
          disabled={Boolean(shellUnavailableReason)}
          icon={<FolderOpen size={15} />}
          tooltip={shellUnavailableReason ?? `浏览${selectedSandboxName}文件`}
          onClick={openSelectedFileManager}
        />
        {activeProjectId ? (
          <SandboxActionButton
            ariaLabel="打开项目详情"
            disabled={false}
            icon={<FolderKanban size={15} />}
            tooltip="项目详情"
            onClick={openProjectRecords}
          />
        ) : null}
        <SandboxActionButton
          ariaLabel="打开子 Agent 面板"
          disabled={subagentTabs.length === 0}
          icon={<PanelRightOpen size={15} />}
          tooltip={subagentTabs.length > 0 ? "打开子 Agent 面板" : "暂无子 Agent 消息"}
          onClick={openSubagentPanel}
        />
      </div>
      <Button icon={<Plus size={16} />} theme="solid" type="primary" onClick={() => selectSession(null)}>
        新建对话
      </Button>
      <span className={cx("stream-status", `stream-status-${status}`)}>
        <Activity size={14} />
        <span>{STATUS_LABEL[status] ?? "空闲"}</span>
      </span>
    </>
  ), [
    activeProjectId,
    canPauseSelectedSandbox,
    canResumeSelectedSandbox,
    canStartSelectedSandbox,
    canStopSelectedSandbox,
    changeSandboxContainer,
    deleteSelectedSandboxContainer,
    openProjectRecords,
    openSelectedFileManager,
    openSelectedNoVNC,
    openSelectedShell,
    openSubagentPanel,
    runSandboxMutation,
    sandboxAction,
    sandboxManageUnavailableReason,
    sandboxContainerId,
    selectableSandboxContainers,
    sandboxLoading,
    screenUnavailableReason,
    selectSession,
    selectedSandboxActionId,
    selectedSandboxContainer,
    selectedSandboxName,
    shellUnavailableReason,
    status,
    subagentTabs.length,
  ]);

  useLayoutEffect(() => {
    setHeaderActions(headerNode);
    return () => setHeaderActions(null);
  }, [headerNode, setHeaderActions]);

  const handleSend = async (content: AgentInputPart[]) => {
    if (selectedSandboxContainer && selectedSandboxContainer.status !== SANDBOX_CONTAINER_STATUS.RUNNING) {
      Toast.warning("请先启动所选执行工作区，再发送给 Agent");
      return false;
    }
    try {
      await send(content, activeSessionId, sandboxContainerId);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className={cx("playground-shell", selectedSubagent && "playground-shell-split")}>
      <div className="playground-main">
        <div className="playground-conversation-frame">
          <div className="playground-main-column">
            <MessageScrollPanel
              ariaLabel="对话消息"
              className="playground-canvas-shell"
              contentClassName="playground-canvas"
              loading={historyLoading}
              loadingPrevious={historyPrepending}
              onLoadPrevious={historyHasMore && !historyPrepending ? () => void loadPreviousHistory() : undefined}
              preserveScrollKey={historyVersion}
              resetKey={activeSessionId ?? "new-chat"}
              scrollButtonClassName="chat-scroll-tail-floating"
              watch={[chatState.nodes, chatState.streaming]}
            >
              {(tailRef) => (
                <ChatStream
                  nodes={chatState.nodes}
                  streaming={chatState.streaming}
                  agents={agents}
                  selectedSubagent={selectedSubagent}
                  tailRef={tailRef}
                  onOpenSubagent={setSelectedSubagent}
                />
              )}
            </MessageScrollPanel>
            <div className="playground-composer">
              <Composer
                streaming={chatState.streaming}
                disabled={historyLoading}
                agents={agents}
                activeAgentCode={activeAgentCode}
                agentSwitchDisabled={agentSwitchDisabled}
                canCancelAll={hasRunningSubagents}
                onPickAgent={setActiveAgentCode}
                onSend={handleSend}
                onInterrupt={() => void interrupt()}
                onCancelAll={() => void cancelAll()}
              />
            </div>
          </div>
          <SubagentSidePanel
            nodes={chatState.nodes}
            tabs={subagentTabs}
            agents={agents}
            selection={selectedSubagent}
            onSelect={setSelectedSubagent}
            onClose={closeSubagentPanel}
          />
        </div>
      </div>
      <WorkProjectInfoModal
        open={projectRecordsOpen && Boolean(activeProjectId)}
        projectId={activeProjectId}
        initialTab="assets"
        onClose={() => setProjectRecordsOpen(false)}
      />
      <PlaygroundSandboxCreateModal
        open={createSandboxOpen}
        onCancel={() => setCreateSandboxOpen(false)}
        onCreated={handleSandboxCreated}
      />
    </div>
  );
}

function SandboxActionButton({ ariaLabel, disabled, icon, loading = false, onClick, tooltip }: SandboxActionButtonProps) {
  return (
    <Tooltip content={tooltip}>
      <span className="sandbox-action-tooltip">
        <Button
          aria-label={ariaLabel}
          className="sandbox-action-button"
          disabled={disabled}
          icon={icon}
          loading={loading}
          theme="borderless"
          type="tertiary"
          onClick={onClick}
        />
      </span>
    </Tooltip>
  );
}

function getSandboxActionUnavailableReason(
  container: SandboxContainer | null,
  options: { requiresControlProxy?: boolean; requiresNoVNC?: boolean },
) {
  if (!container) return "请先选择执行工作区";
  if (container.status !== SANDBOX_CONTAINER_STATUS.RUNNING) return "所选执行工作区未运行";
  if (options.requiresControlProxy && container.control_proxy_host_port <= 0) return "所选工作区的控制端口尚未就绪";
  if (options.requiresNoVNC && !canOpenContainerNoVNC(container)) return "便携版工作区没有可用的远程桌面";
  return null;
}

function getSandboxAccessUnavailableReason(
  container: SandboxContainer | null,
) {
  if (!container) return null;
  if (canManageSandboxContainer(container)) return null;
  return "没有访问此执行工作区的权限";
}

function upsertSandboxContainer(containers: SandboxContainer[], nextContainer: SandboxContainer) {
  if (!containers.some((container) => container.id === nextContainer.id)) {
    return [nextContainer, ...containers];
  }
  return containers.map((container) => (
    container.id === nextContainer.id ? nextContainer : container
  ));
}

function findSandboxContainerById(containers: SandboxContainer[], id: number | null) {
  if (id === null) return null;
  return containers.find((container) => container.id === id) ?? null;
}

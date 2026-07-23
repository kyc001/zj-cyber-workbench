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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdminHeaderActions } from "../../app/layouts/AdminLayout";
import { getApiErrorMessage, showApiError, showApiSuccess } from "../../shared/api/feedback";
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
  uploadContainerFiles,
} from "../../shared/api/sandboxContainers";
import type { AgentFileInputPart, AgentInputPart, SandboxContainer } from "../../shared/api/types";
import { getWorkProjectRecordSnapshot } from "../../shared/api/workProjects";
import { cx } from "../../shared/lib/className";
import { UI_TEXT } from "../../shared/lib/uiText";
import { useContainerShell } from "../container-shell/ContainerShellProvider";
import { DeferredWorkProjectInfoModal } from "../work-projects/DeferredWorkProjectInfoModal";
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
    chatState, status, historyLoading, historyError, historyHasMore, historyPrepending, historyVersion,
    agents, defaultAgentCode, activeAgentCode, setActiveAgentCode,
    send, updateSelectedSandboxContainer, interrupt, cancelAll, loadPreviousHistory, retryHistory,
  } = useAgentSessionContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [availableSandboxContainers, setAvailableSandboxContainers] = useState<SandboxContainer[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxLoadError, setSandboxLoadError] = useState("");
  const [sandboxSelectionSaving, setSandboxSelectionSaving] = useState(false);
  const [sandboxContainerId, setSandboxContainerId] = useState<number | null>(null);
  const [projectSandboxContainerId, setProjectSandboxContainerId] = useState<number | null>(null);
  const [projectSandboxContainer, setProjectSandboxContainer] = useState<SandboxContainer | null>(null);
  const [projectSandboxScopeLoaded, setProjectSandboxScopeLoaded] = useState(false);
  const [projectRecordsOpen, setProjectRecordsOpen] = useState(false);
  const [createSandboxOpen, setCreateSandboxOpen] = useState(false);
  const [sandboxAction, setSandboxAction] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sendPreparing, setSendPreparing] = useState(false);
  const sandboxActionRef = useRef<string | null>(null);
  const sendRequestRef = useRef(false);
  const retryingRef = useRef(false);
  const sandboxRequestRef = useRef(0);
  const sandboxDataScopeRef = useRef<string | null>(null);
  const sandboxSelectionRequestRef = useRef(0);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const {
    fileManagerDirty,
    openFileManager,
    openNoVNC,
    openShell,
    syncContainerWindows,
  } = useContainerShell();
  const { selectedSubagent, setSelectedSubagent, subagentTabs, closeSubagentPanel } = useSubagentPanel(chatState, activeSessionId);
  const hasRunningSubagents = subagentTabs.some((tab) => tab.status === "running");
  const agentSwitchDisabled = activeAgentCode === defaultAgentCode && hasRunningSubagents;
  const retryContent = useMemo(() => {
    for (let index = chatState.nodes.length - 1; index >= 0; index -= 1) {
      const node = chatState.nodes[index];
      if (node.kind === "user") return node.content;
    }
    return null;
  }, [chatState.nodes]);
  const showRunRecovery = Boolean(activeSessionSummary?.run_error && retryContent && !chatState.streaming);

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
  const sandboxMutationBusy = sandboxAction !== null;
  const sandboxLifecycleLocked = sandboxMutationBusy || fileManagerDirty;
  const sandboxLifecycleUnavailableReason = fileManagerDirty
    ? "请先保存或放弃文件修改"
    : sandboxManageUnavailableReason;
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

  const openAttachedFile = useCallback((file: AgentFileInputPart) => {
    if (!selectedSandboxContainer) {
      Toast.warning("当前会话没有可用的执行工作区");
      return;
    }
    if (selectedSandboxContainer.status !== SANDBOX_CONTAINER_STATUS.RUNNING) {
      Toast.warning("请先启动执行工作区，再查看附件");
      return;
    }
    if (selectedSandboxContainer.control_proxy_host_port <= 0) {
      Toast.warning("执行工作区的文件服务尚未就绪");
      return;
    }
    openFileManager(selectedSandboxContainer, parentSandboxPath(file.path));
  }, [openFileManager, selectedSandboxContainer]);

  const openSelectedShell = useCallback(() => {
    if (selectedSandboxContainer) openShell(selectedSandboxContainer);
  }, [openShell, selectedSandboxContainer]);

  const openSelectedNoVNC = useCallback(() => {
    if (selectedSandboxContainer) openNoVNC(selectedSandboxContainer);
  }, [openNoVNC, selectedSandboxContainer]);

  const loadSandboxes = useCallback(async () => {
    const requestId = sandboxRequestRef.current + 1;
    const scopeKey = activeProjectId === null ? "all" : `project:${activeProjectId}`;
    sandboxRequestRef.current = requestId;
    setSandboxLoading(true);
    setSandboxLoadError("");
    if (sandboxDataScopeRef.current !== scopeKey) {
      setAvailableSandboxContainers([]);
    }
    try {
      const availableResponse = await queryAvailableSandboxContainers({
        page: 1,
        size: 100,
        keyword: "",
        work_project_id: activeProjectId ?? undefined,
        include_non_running: true,
      });
      if (sandboxRequestRef.current !== requestId) return;
      sandboxDataScopeRef.current = scopeKey;
      setAvailableSandboxContainers(availableResponse.data?.items ?? []);
    } catch (error) {
      if (sandboxRequestRef.current !== requestId) return;
      setSandboxLoadError(getApiErrorMessage(error, "加载执行工作区失败"));
    } finally {
      if (sandboxRequestRef.current === requestId) setSandboxLoading(false);
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
    sandboxSelectionRequestRef.current += 1;
    setSandboxSelectionSaving(false);
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
    const targetSessionId = activeSessionId;
    const requestId = sandboxSelectionRequestRef.current + 1;
    sandboxSelectionRequestRef.current = requestId;
    setSandboxSelectionSaving(true);
    try {
      const summary = await updateSelectedSandboxContainer(targetSessionId, nextContainerId);
      if (
        sandboxSelectionRequestRef.current !== requestId
        || activeSessionIdRef.current !== targetSessionId
      ) return;
      const selectedId = summary?.selected_sandbox_container_id ?? null;
      setSandboxContainerId(selectedId);
      syncContainerWindows(findSandboxContainerById(selectableSandboxContainers, selectedId));
    } catch (error) {
      if (
        sandboxSelectionRequestRef.current === requestId
        && activeSessionIdRef.current === targetSessionId
      ) showApiError(error);
    } finally {
      if (sandboxSelectionRequestRef.current === requestId) {
        setSandboxSelectionSaving(false);
      }
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
    if (!container || sandboxActionRef.current) return;
    if (fileManagerDirty) {
      Toast.warning("请先保存或放弃文件修改");
      return;
    }
    const actionKey = `${action}:${container.id}`;
    sandboxActionRef.current = actionKey;
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
      if (sandboxActionRef.current === actionKey) {
        sandboxActionRef.current = null;
        setSandboxAction(null);
      }
    }
  }, [fileManagerDirty, loadSandboxes, projectSandboxContainerId, syncContainerWindows]);

  const deleteSelectedSandboxContainer = useCallback(async () => {
    if (!selectedSandboxContainer || sandboxActionRef.current) return;
    if (fileManagerDirty) {
      Toast.warning("请先保存或放弃文件修改");
      return;
    }
    const actionKey = `delete:${selectedSandboxContainer.id}`;
    sandboxActionRef.current = actionKey;
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
      if (sandboxActionRef.current === actionKey) {
        sandboxActionRef.current = null;
        setSandboxAction(null);
      }
    }
  }, [fileManagerDirty, loadSandboxes, projectSandboxContainerId, refreshSessions, selectedSandboxContainer, syncContainerWindows]);

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
        updating={sandboxSelectionSaving}
        error={sandboxLoadError}
        value={sandboxContainerId}
        className="sandbox-selector-topbar"
        disabled={Boolean(activeProjectId) || sandboxLifecycleLocked}
        onChange={(id) => void changeSandboxContainer(id)}
      />
      <div className="sandbox-container-actions" aria-label="执行工作区操作">
        {sandboxLoadError ? (
          <SandboxActionButton
            ariaLabel="重新加载执行工作区"
            disabled={sandboxLoading}
            icon={<RotateCcw size={15} />}
            loading={sandboxLoading}
            tooltip={`${sandboxLoadError}，点击重试`}
            onClick={() => void loadSandboxes()}
          />
        ) : null}
        <SandboxActionButton
          ariaLabel="创建执行工作区"
          disabled={Boolean(activeProjectId) || sandboxLifecycleLocked}
          icon={<Box size={15} />}
          tooltip={activeProjectId
            ? "项目会话使用项目绑定的工作区"
            : sandboxLifecycleUnavailableReason ?? "创建执行工作区"}
          onClick={() => setCreateSandboxOpen(true)}
        />
        {selectedSandboxContainer?.status === SANDBOX_CONTAINER_STATUS.RUNNING ? (
          <>
            <SandboxActionButton
              ariaLabel={`停止${selectedSandboxName}`}
              disabled={sandboxLifecycleLocked || !canStopSelectedSandbox}
              icon={<SquareStop size={15} />}
              loading={sandboxAction === `stop:${selectedSandboxActionId}`}
              tooltip={sandboxLifecycleUnavailableReason ?? `停止${selectedSandboxName}`}
              onClick={() => void runSandboxMutation("stop", selectedSandboxContainer)}
            />
            <SandboxActionButton
              ariaLabel={`暂停${selectedSandboxName}`}
              disabled={sandboxLifecycleLocked || !canPauseSelectedSandbox}
              icon={<Pause size={15} />}
              loading={sandboxAction === `pause:${selectedSandboxActionId}`}
              tooltip={sandboxLifecycleUnavailableReason ?? `暂停${selectedSandboxName}`}
              onClick={() => void runSandboxMutation("pause", selectedSandboxContainer)}
            />
          </>
        ) : selectedSandboxContainer?.status === SANDBOX_CONTAINER_STATUS.PAUSED ? (
          <SandboxActionButton
            ariaLabel={`恢复${selectedSandboxName}`}
            disabled={sandboxLifecycleLocked || !canResumeSelectedSandbox}
            icon={<RotateCcw size={15} />}
            loading={sandboxAction === `resume:${selectedSandboxActionId}`}
            tooltip={sandboxLifecycleUnavailableReason ?? `恢复${selectedSandboxName}`}
            onClick={() => void runSandboxMutation("resume", selectedSandboxContainer)}
          />
        ) : (
          <SandboxActionButton
            ariaLabel={`启动${selectedSandboxName}`}
            disabled={sandboxLifecycleLocked || !canStartSelectedSandbox}
            icon={<Play size={15} />}
            loading={sandboxAction === `start:${selectedSandboxActionId}`}
            tooltip={sandboxLifecycleUnavailableReason ?? (canStartSelectedSandbox ? `启动${selectedSandboxName}` : "请选择已创建或已停止的工作区")}
            onClick={() => void runSandboxMutation("start", selectedSandboxContainer)}
          />
        )}
        <SandboxActionButton
          ariaLabel={`打开${selectedSandboxName}终端`}
          disabled={sandboxMutationBusy || Boolean(shellUnavailableReason)}
          icon={<SquareTerminal size={15} />}
          tooltip={shellUnavailableReason ?? `打开${selectedSandboxName}终端`}
          onClick={openSelectedShell}
        />
        <SandboxActionButton
          ariaLabel={`打开${selectedSandboxName}桌面`}
          disabled={sandboxMutationBusy || Boolean(screenUnavailableReason)}
          icon={<Monitor size={15} />}
          tooltip={screenUnavailableReason ?? `打开${selectedSandboxName}桌面`}
          onClick={openSelectedNoVNC}
        />
        <SandboxActionButton
          ariaLabel={`浏览${selectedSandboxName}文件`}
          disabled={sandboxMutationBusy || Boolean(shellUnavailableReason)}
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
              disabled={sandboxLifecycleLocked || !selectedSandboxContainer || Boolean(sandboxManageUnavailableReason)}
              icon={<Trash2 size={15} />}
              loading={sandboxAction === `delete:${selectedSandboxActionId}`}
              tooltip={sandboxLifecycleUnavailableReason ?? (selectedSandboxContainer ? `删除${selectedSandboxName}` : "请先选择工作区")}
              onClick={() => undefined}
            />
          </span>
        </Popconfirm>
      </div>
      <Button
        className="playground-new-session-button"
        icon={<Plus size={16} />}
        theme="solid"
        type="primary"
        aria-label="新建对话"
        title="新建对话"
        onClick={() => selectSession(null)}
      >
        <span className="playground-new-session-label">新建对话</span>
      </Button>
      <span
        className={cx("stream-status", `stream-status-${status}`)}
        aria-label={`实时连接状态：${STATUS_LABEL[status] ?? "空闲"}`}
        title={`实时连接状态：${STATUS_LABEL[status] ?? "空闲"}`}
      >
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
    sandboxLifecycleLocked,
    sandboxLifecycleUnavailableReason,
    sandboxMutationBusy,
    sandboxManageUnavailableReason,
    sandboxContainerId,
    sandboxLoadError,
    loadSandboxes,
    selectableSandboxContainers,
    sandboxLoading,
    sandboxSelectionSaving,
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

  const handleSend = async (content: AgentInputPart[], files: File[] = []) => {
    if (sendRequestRef.current) {
      Toast.warning("消息正在发送，请稍候");
      return false;
    }
    if (selectedSandboxContainer && selectedSandboxContainer.status !== SANDBOX_CONTAINER_STATUS.RUNNING) {
      Toast.warning("请先启动所选执行工作区，再发送给 Agent");
      return false;
    }
    if (files.length && (!sandboxContainerId || !selectedSandboxContainer)) {
      Toast.warning("请先选择执行工作区，再发送文件");
      return false;
    }
    sendRequestRef.current = true;
    setSendPreparing(true);
    let turnSubmissionStarted = false;
    try {
      let nextContent = content;
      if (files.length && sandboxContainerId) {
        const response = await uploadContainerFiles(
          sandboxContainerId,
          createMessageUploadPath(),
          files,
          false,
        );
        const uploaded = response.data?.files ?? [];
        if (uploaded.length !== files.length) {
          throw new Error("文件上传结果不完整");
        }
        const fileParts: AgentFileInputPart[] = uploaded.map((item, index) => ({
          type: "file",
          name: item.name,
          path: item.path,
          size: item.size,
          sha256: item.sha256,
          media_type: files[index]?.type || "application/octet-stream",
        }));
        nextContent = [...content, ...fileParts];
      }
      turnSubmissionStarted = true;
      await send(nextContent, activeSessionId, sandboxContainerId);
      return true;
    } catch (error) {
      if (!turnSubmissionStarted) showApiError(error);
      return false;
    } finally {
      sendRequestRef.current = false;
      setSendPreparing(false);
    }
  };

  const retryLastTurn = async () => {
    if (!retryContent || retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      await handleSend(retryContent);
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  };

  return (
    <div className={cx(
      "playground-shell",
      selectedSubagent && "playground-shell-split",
      showRunRecovery && "playground-has-run-recovery",
    )}>
      <div className="playground-main">
        <div className="playground-conversation-frame">
          <div className="playground-main-column">
            <MessageScrollPanel
              ariaLabel="对话消息"
              className="playground-canvas-shell"
              contentClassName="playground-canvas"
              error={historyError}
              loading={historyLoading}
              loadingPrevious={historyPrepending}
              onLoadPrevious={historyHasMore && !historyPrepending ? () => void loadPreviousHistory() : undefined}
              onRetry={() => retryHistory()}
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
                  onOpenFile={openAttachedFile}
                  onOpenSubagent={setSelectedSubagent}
                />
              )}
            </MessageScrollPanel>
            <div className="playground-composer">
              {showRunRecovery ? (
                <div className="playground-run-recovery" role="alert">
                  <span className="playground-run-recovery-copy">
                    <strong>上次运行未完成</strong>
                    <span>{activeSessionSummary?.run_error}</span>
                  </span>
                  <Button
                    icon={<RotateCcw size={14} />}
                    loading={retrying}
                    theme="borderless"
                    type="danger"
                    onClick={() => void retryLastTurn()}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              <Composer
                draftKey={activeSessionId ?? "new-session"}
                streaming={chatState.streaming}
                disabled={sendPreparing || historyLoading || Boolean(historyError)}
                disabledReason={sendPreparing
                  ? "正在准备并发送消息"
                  : historyError
                    ? "请先重新加载会话历史"
                    : ""}
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
      <DeferredWorkProjectInfoModal
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

function createMessageUploadPath(): string {
  const token = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `/inbox/messages/${token}`;
}

function parentSandboxPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex <= 0 ? "/" : normalized.slice(0, separatorIndex);
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

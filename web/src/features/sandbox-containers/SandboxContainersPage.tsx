import { Button, Popconfirm, Select, Tag, Tooltip } from "@douyinfe/semi-ui";
import {
  Box,
  Boxes,
  Fingerprint,
  FolderOpen,
  Monitor,
  Network,
  Pause,
  Play,
  RotateCcw,
  Route,
  SquareStop,
  SquareTerminal,
  Trash2,
  User,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { queryEgressProxies } from "../../shared/api/egressProxies";
import { queryManagedHosts } from "../../shared/api/hosts";
import {
  canManageSandboxContainer,
  canOpenContainerNoVNC,
  createSandboxContainer,
  deleteSandboxContainer,
  pauseSandboxContainer,
  querySandboxContainers,
  resumeSandboxContainer,
  startSandboxContainer,
  stopSandboxContainer,
  updateSandboxContainerEgress,
} from "../../shared/api/sandboxContainers";
import { querySandboxImages } from "../../shared/api/sandboxImages";
import { querySystemUsers } from "../../shared/api/systemUsers";
import { SANDBOX_CONTAINER_EGRESS_MODE, SANDBOX_CONTAINER_STATUS } from "../../shared/api/generated/constants";
import type { CreateSandboxContainerRequest, EgressProxy, ManagedHost, SandboxContainer, SandboxContainerEgressMode, SandboxImage, SystemUser } from "../../shared/api/types";
import { ResourcePageShell } from "../../shared/components/ResourcePageShell";
import { ResourceTable, type ResourceColumn } from "../../shared/components/ResourceTable";
import { OwnerCell, ResourceIdentity, ResourceText, RowActions } from "../../shared/components/ResourceCells";
import { ResourceFormLoadError, ResourceModal } from "../../shared/components/ResourceModal";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";
import { useOptionList } from "../../shared/hooks/useOptionList";
import { usePagedResourceList } from "../../shared/hooks/usePagedResourceList";
import { useResourceAction } from "../../shared/hooks/useResourceAction";
import { useResourceSubmit } from "../../shared/hooks/useResourceSubmit";
import { useAuth } from "../../shared/auth/AuthProvider";
import { formatDateTime } from "../../shared/lib/date";
import { SANDBOX_CONTAINER_STATUS_COLOR, SANDBOX_CONTAINER_STATUS_LABEL } from "../../shared/lib/labels";
import { UI_TEXT } from "../../shared/lib/uiText";
import { useContainerShell } from "../container-shell/ContainerShellProvider";
import { SandboxContainerFormModal } from "./SandboxContainerFormModal";

type ContainerActionKind = "start" | "stop" | "pause" | "resume" | "delete";

type ContainerActionRequest = {
  id: number;
  container: SandboxContainer;
  kind: ContainerActionKind;
};

const CONTAINER_ACTION_LABEL: Record<ContainerActionKind, string> = {
  start: "启动",
  stop: "停止",
  pause: "暂停",
  resume: "恢复",
  delete: "删除",
};

export function SandboxContainersPage() {
  const { user } = useAuth();
  const {
    items: containers, page, keyword, activeKeyword, loading, error, loadItems: loadContainers, total, rangeStart, rangeEnd,
    setKeyword, search, clearSearch, previous, next, canGoBack, canGoNext,
  } = usePagedResourceList<SandboxContainer>({ query: querySandboxContainers });
  const [modalOpen, setModalOpen] = useState(false);
  const {
    items: images,
    loading: imagesLoading,
    error: imagesError,
    load: loadReadyImages,
  } = useOptionList<SandboxImage>({ query: querySandboxImages });
  const {
    items: hosts,
    loading: hostsLoading,
    error: hostsError,
    load: loadHosts,
  } = useOptionList<ManagedHost>({ query: queryManagedHosts });
  const {
    items: users,
    loading: usersLoading,
    error: usersError,
    load: loadUsers,
  } = useOptionList<SystemUser>({ query: querySystemUsers });
  const {
    items: egressProxies,
    loading: egressProxiesLoading,
    error: egressProxiesError,
    load: loadEgressProxies,
  } = useOptionList<EgressProxy>({ query: queryEgressProxies });
  const [egressModalContainer, setEgressModalContainer] = useState<SandboxContainer | null>(null);
  const { openFileManager, openNoVNC, openShell } = useContainerShell();

  const refreshOptions = useCallback(async () => {
    await Promise.all([
      loadReadyImages(),
      loadHosts(),
      loadUsers(),
      loadEgressProxies(),
    ]);
  }, [loadEgressProxies, loadHosts, loadReadyImages, loadUsers]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadContainers(), refreshOptions()]);
  }, [loadContainers, refreshOptions]);

  const executeContainerAction = useCallback((request: ContainerActionRequest) => {
    switch (request.kind) {
      case "start":
        return startSandboxContainer(request.id);
      case "stop":
        return stopSandboxContainer(request.id);
      case "pause":
        return pauseSandboxContainer(request.id);
      case "resume":
        return resumeSandboxContainer(request.id);
      case "delete":
        return deleteSandboxContainer(request.id);
    }
  }, []);
  const {
    run: runContainerAction,
    busyId: actionBusyId,
    busyItem: busyAction,
  } = useResourceAction<ContainerActionRequest>(executeContainerAction, loadContainers);
  const requestContainerAction = useCallback((container: SandboxContainer, kind: ContainerActionKind) => (
    runContainerAction({ id: container.id, container, kind })
  ), [runContainerAction]);

  useAdminResourceHeader({
    createLabel: "创建执行工作区",
    refreshLabel: "刷新执行工作区",
    createDisabled: actionBusyId !== null,
    loading: loading || imagesLoading || hostsLoading || usersLoading || egressProxiesLoading || actionBusyId !== null,
    onCreate: () => setModalOpen(true),
    onRefresh: refreshAll,
  });

  const { saving, submit } = useResourceSubmit({
    onSuccess: async () => {
      setModalOpen(false);
      await loadContainers();
    },
  });

  const summary = useMemo(
    () => containers.reduce(
      (acc, container) => ({
        running: acc.running + (container.status === SANDBOX_CONTAINER_STATUS.RUNNING ? 1 : 0),
        paused: acc.paused + (container.status === SANDBOX_CONTAINER_STATUS.PAUSED ? 1 : 0),
        created: acc.created + (container.status === SANDBOX_CONTAINER_STATUS.CREATED ? 1 : 0),
        stopped: acc.stopped + (container.status === SANDBOX_CONTAINER_STATUS.STOPPED ? 1 : 0),
      }),
      { running: 0, paused: 0, created: 0, stopped: 0 },
    ),
    [containers],
  );

  const handleCreate = (payload: CreateSandboxContainerRequest) => submit(() => createSandboxContainer(payload));

  const columns: ResourceColumn<SandboxContainer>[] = [
    {
      key: "container", header: "执行工作区", width: "minmax(0, 0.88fr)",
      render: (container) => (
        <ResourceIdentity
          icon={<Box size={18} />}
          title={container.container_name}
          detail={<span className="container-hash"><Fingerprint size={13} />{renderContainerHash(container.container_hash)}</span>}
        />
      ),
    },
    {
      key: "status", header: "状态", width: "84px",
      render: (container) => (
        <Tag color={SANDBOX_CONTAINER_STATUS_COLOR[container.status]}>{SANDBOX_CONTAINER_STATUS_LABEL[container.status]}</Tag>
      ),
    },
    {
      key: "host", header: "主机", width: "150px",
      render: (container) => (
        <ResourceText title={formatContainerHost(container)}>
          {container.host_display_name || container.host_ip_address}
        </ResourceText>
      ),
    },
    {
      key: "image", header: "工具基线", width: "minmax(0, 0.62fr)",
      render: (container) => <ResourceText title={container.image_name}>{container.image_name}</ResourceText>,
    },
    {
      key: "owner", header: "所有者", width: "minmax(0, 0.58fr)",
      render: (container) => <OwnerCell>{container.owner_username}</OwnerCell>,
    },
    {
      key: "ports", header: "映射", width: "minmax(0, 0.56fr)",
      render: (container) => renderContainerPorts(container),
    },
    {
      key: "egress", header: "网络出口", width: "minmax(0, 0.48fr)",
      render: (container) => (
        <Tag color={egressTagColor(container.egress_mode)}>{container.egress_label || container.egress_mode.toUpperCase()}</Tag>
      ),
    },
    { key: "updated", header: "更新时间", width: "200px", render: (c) => formatDateTime(c.updated_at) },
    {
      key: "actions", header: "操作", width: "256px",
      render: (container) => {
        const canManage = canManageSandboxContainer(container);
        const rowBusy = actionBusyId === container.id;
        const busyReason = busyAction
          ? `正在${CONTAINER_ACTION_LABEL[busyAction.kind]} ${busyAction.container.container_name}，请稍候`
          : "";
        const permissionReason = canManage ? "" : "无权管理此执行工作区";
        const serviceReason = container.status !== SANDBOX_CONTAINER_STATUS.RUNNING
          ? "请先启动执行工作区"
          : container.control_proxy_host_port <= 0 ? "文件与终端服务尚未就绪" : "";
        const desktopReason = container.status !== SANDBOX_CONTAINER_STATUS.RUNNING
          ? "请先启动执行工作区"
          : !canOpenContainerNoVNC(container) ? "当前工具基线未提供远程桌面" : "";
        const startReason = container.status === SANDBOX_CONTAINER_STATUS.CREATED
          || container.status === SANDBOX_CONTAINER_STATUS.STOPPED ? "" : "仅已创建或已停止的工作区可以启动";
        const runningReason = container.status === SANDBOX_CONTAINER_STATUS.RUNNING ? "" : "仅运行中的工作区可执行此操作";
        const resumeReason = container.status === SANDBOX_CONTAINER_STATUS.PAUSED ? "" : "仅已暂停的工作区可以恢复";
        const disabledReason = (reason = "") => busyReason || permissionReason || reason;
        const deleteDisabledReason = disabledReason();
        const deleteButton = (
          <ContainerActionButton
            icon={<Trash2 size={15} />}
            label={`删除 ${container.container_name}`}
            type="danger"
            disabledReason={deleteDisabledReason}
            loading={rowBusy && busyAction?.kind === "delete"}
          />
        );
        return (
          <RowActions>
            <ContainerActionButton
              icon={<FolderOpen size={15} />}
              label={`浏览 ${container.container_name} 文件`}
              disabledReason={disabledReason(serviceReason)}
              onClick={() => openFileManager(container)}
            />
            <ContainerActionButton
              icon={<SquareTerminal size={15} />}
              label={`打开 ${container.container_name} 终端`}
              disabledReason={disabledReason(serviceReason)}
              onClick={() => openShell(container)}
            />
            <ContainerActionButton
              icon={<Monitor size={15} />}
              label={`打开 ${container.container_name} 桌面`}
              disabledReason={disabledReason(desktopReason)}
              onClick={() => openNoVNC(container)}
            />
            <ContainerActionButton
              icon={<Network size={15} />}
              label={`设置 ${container.container_name} 网络出口`}
              disabledReason={disabledReason()}
              onClick={() => setEgressModalContainer(container)}
            />
            <ContainerActionButton
              icon={<Play size={15} />}
              label={`启动 ${container.container_name}`}
              type="primary"
              disabledReason={disabledReason(startReason)}
              loading={rowBusy && busyAction?.kind === "start"}
              onClick={() => void requestContainerAction(container, "start")}
            />
            <ContainerActionButton
              icon={<SquareStop size={15} />}
              label={`停止 ${container.container_name}`}
              type="danger"
              disabledReason={disabledReason(runningReason)}
              loading={rowBusy && busyAction?.kind === "stop"}
              onClick={() => void requestContainerAction(container, "stop")}
            />
            <ContainerActionButton
              icon={<Pause size={15} />}
              label={`暂停 ${container.container_name}`}
              disabledReason={disabledReason(runningReason)}
              loading={rowBusy && busyAction?.kind === "pause"}
              onClick={() => void requestContainerAction(container, "pause")}
            />
            <ContainerActionButton
              icon={<RotateCcw size={15} />}
              label={`恢复 ${container.container_name}`}
              type="primary"
              disabledReason={disabledReason(resumeReason)}
              loading={rowBusy && busyAction?.kind === "resume"}
              onClick={() => void requestContainerAction(container, "resume")}
            />
            {deleteDisabledReason ? deleteButton : (
              <Popconfirm
                title="删除执行工作区"
                content={`确定删除 ${container.container_name}？工作区内尚未导出的文件将无法恢复。`}
                okType="danger"
                cancelText={UI_TEXT.cancel}
                onConfirm={() => void requestContainerAction(container, "delete")}
              >
                {deleteButton}
              </Popconfirm>
            )}
          </RowActions>
        );
      },
    },
  ];

  return (
    <>
      <ResourcePageShell
        searchPlaceholder="搜索工作区、工具基线、所有者或状态"
        keyword={keyword}
        activeKeyword={activeKeyword}
        loading={loading}
        error={error}
        metrics={[
          { label: "总数", value: total },
          { label: "本页运行中", value: summary.running },
          { label: "本页已暂停", value: summary.paused },
          { label: "本页已创建", value: summary.created },
          { label: "本页已停止", value: summary.stopped },
        ]}
        empty={containers.length === 0}
        emptyIcon={<Boxes size={42} />}
        emptyTitle="未找到执行工作区"
        page={page}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        total={total}
        canGoBack={canGoBack}
        canGoNext={canGoNext}
        onKeywordChange={setKeyword}
        onSearch={search}
        onClearSearch={clearSearch}
        onPrevious={previous}
        onNext={next}
        onRetry={loadContainers}
      >
        <ResourceTable<SandboxContainer>
          ariaLabel="执行工作区"
          className="sandbox-containers-table"
          columns={columns}
          rows={containers}
          rowKey={(container) => container.id}
        />
      </ResourcePageShell>

      <SandboxContainerFormModal
        open={modalOpen}
        saving={saving}
        images={images}
        imagesLoading={imagesLoading}
        hosts={hosts}
        hostsLoading={hostsLoading}
        users={users}
        usersLoading={usersLoading}
        egressProxies={egressProxies}
        egressProxiesLoading={egressProxiesLoading}
        optionLoadIssues={[
          ...(imagesError ? [{ label: "工具基线", message: imagesError }] : []),
          ...(hostsError ? [{ label: "运行主机", message: hostsError }] : []),
          ...(usersError ? [{ label: "所有者", message: usersError }] : []),
          ...(egressProxiesError ? [{ label: "出口代理", message: egressProxiesError }] : []),
        ]}
        optionsLoading={imagesLoading || hostsLoading || usersLoading || egressProxiesLoading}
        currentUserId={user?.id ?? 0}
        onRetryOptions={() => void refreshOptions()}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
      <ContainerEgressModal
        container={egressModalContainer}
        egressProxies={egressProxies}
        loading={egressProxiesLoading}
        error={egressProxiesError}
        onRetry={() => void loadEgressProxies()}
        onClose={() => setEgressModalContainer(null)}
        onSaved={async () => {
          setEgressModalContainer(null);
          await loadContainers();
        }}
      />
    </>
  );
}

function ContainerEgressModal({
  container,
  egressProxies,
  loading,
  error,
  onRetry,
  onClose,
  onSaved,
}: {
  container: SandboxContainer | null;
  egressProxies: EgressProxy[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [egressMode, setEgressMode] = useState<SandboxContainerEgressMode>(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
  const [selectedProxyId, setSelectedProxyId] = useState<number | undefined>();
  const { saving, submit } = useResourceSubmit({ onSuccess: onSaved });

  useEffect(() => {
    setEgressMode(container?.egress_mode ?? SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
    setSelectedProxyId(container?.egress_proxy_id ?? undefined);
  }, [container]);

  const nextProxyId = egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY ? selectedProxyId : undefined;
  const currentProxyId = container?.egress_mode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY
    ? container.egress_proxy_id ?? undefined
    : undefined;
  const dirty = Boolean(container) && (
    egressMode !== container?.egress_mode
    || nextProxyId !== currentProxyId
  );

  const save = () => {
    if (!container) return;
    return submit(() => (
      updateSandboxContainerEgress(container.id, {
        egress_mode: egressMode,
        egress_proxy_id: nextProxyId,
      })
    ));
  };

  return (
    <ResourceModal
      title={container ? `网络出口：${container.container_name}` : "网络出口"}
      open={Boolean(container)}
      width={460}
      saving={saving}
      dirty={dirty}
      submitLabel={UI_TEXT.save}
      submitDisabled={!dirty || (egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY && !selectedProxyId)}
      onSubmit={save}
      onCancel={onClose}
    >
        {egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY && error ? (
          <ResourceFormLoadError
            issues={[{ label: "出口代理", message: error }]}
            loading={loading}
            onRetry={onRetry}
          />
        ) : null}
        <label>
          <span>网络出口模式</span>
          <Select
            prefix={<Route size={16} />}
            aria-label="网络出口模式"
            value={egressMode}
            optionList={[
              { label: "直连", value: SANDBOX_CONTAINER_EGRESS_MODE.DIRECT },
              { label: "出口代理", value: SANDBOX_CONTAINER_EGRESS_MODE.PROXY },
              { label: "Tor 代理", value: SANDBOX_CONTAINER_EGRESS_MODE.TOR, disabled: !container?.supports_tor },
            ]}
            onChange={(value) => {
              if (typeof value !== "string") return;
              const next = value as SandboxContainerEgressMode;
              setEgressMode(next);
              if (next !== SANDBOX_CONTAINER_EGRESS_MODE.PROXY) setSelectedProxyId(undefined);
            }}
          />
        </label>
        {egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY ? (
          <label>
            <span>出口代理</span>
            <Select
              prefix={<Network size={16} />}
              aria-label="出口代理"
              value={selectedProxyId}
              loading={loading}
              placeholder="选择出口代理"
              emptyContent="暂无出口代理"
              optionList={egressProxies.map((proxy) => ({ label: egressProxyOptionLabel(proxy), value: proxy.id }))}
              onChange={(value) => setSelectedProxyId(typeof value === "number" ? value : undefined)}
            />
          </label>
        ) : null}
    </ResourceModal>
  );
}

function ContainerActionButton({
  disabledReason = "",
  icon,
  label,
  loading = false,
  onClick,
  type = "tertiary",
}: {
  disabledReason?: string;
  icon: ReactNode;
  label: string;
  loading?: boolean;
  onClick?: () => void;
  type?: "primary" | "tertiary" | "danger";
}) {
  return (
    <Tooltip content={disabledReason || label}>
      <span
        className="row-action-tooltip-target"
        tabIndex={disabledReason ? 0 : undefined}
        role={disabledReason ? "button" : undefined}
        aria-disabled={disabledReason ? true : undefined}
        aria-label={disabledReason ? `${label}：${disabledReason}` : undefined}
      >
        <Button
          icon={icon}
          theme="borderless"
          type={type}
          disabled={Boolean(disabledReason)}
          loading={loading}
          aria-label={label}
          aria-hidden={disabledReason ? true : undefined}
          tabIndex={disabledReason ? -1 : undefined}
          onClick={onClick}
        />
      </span>
    </Tooltip>
  );
}

function renderContainerHash(containerHash: string) {
  if (!containerHash) return <>等待创建</>;
  return <Tooltip content={containerHash}>{containerHash.slice(0, 12)}</Tooltip>;
}

function formatContainerHost(container: SandboxContainer) {
  if (container.host_execution_backend === "local") return `${container.host_display_name || "本机"} · 本地执行`;
  return `${container.host_display_name || container.host_ip_address} · ${container.host_account}@${container.host_ip_address}:${container.host_ssh_port}`;
}

function renderContainerPorts(container: SandboxContainer) {
  return (
    <div className="port-mapping-list">
      {container.control_proxy_host_port > 0 ? <Tag color="green">
        控制 {container.control_proxy_host_port}:{container.control_proxy_port}/tcp
      </Tag> : null}
      {container.port_mappings.length === 0 && container.control_proxy_host_port <= 0 ? <ResourceText>本机工作目录</ResourceText> : null}
      {container.port_mappings.map((mapping) => (
        <Tag key={`${mapping.host_port}-${mapping.container_port}-${mapping.protocol}`} color="blue">
          {mapping.host_port}:{mapping.container_port}/{mapping.protocol}
        </Tag>
      ))}
    </div>
  );
}

function egressProxyOptionLabel(proxy: EgressProxy) {
  return `${proxy.proxy_type}://${proxy.proxy_host}:${proxy.proxy_port}`;
}

function egressTagColor(mode: SandboxContainerEgressMode) {
  if (mode === SANDBOX_CONTAINER_EGRESS_MODE.TOR) return "violet";
  if (mode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY) return "blue";
  return "grey";
}

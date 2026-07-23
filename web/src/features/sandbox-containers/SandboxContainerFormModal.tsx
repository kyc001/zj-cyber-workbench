import { Select } from "@douyinfe/semi-ui";
import { Boxes, Network, Route, Server, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SANDBOX_CONTAINER_EGRESS_MODE } from "../../shared/api/generated/constants";
import type { CreateSandboxContainerRequest, EgressProxy, ManagedHost, SandboxContainerEgressMode, SandboxImage, SystemUser } from "../../shared/api/types";
import {
  ResourceFormLoadError,
  ResourceModal,
  type ResourceFormLoadIssue,
} from "../../shared/components/ResourceModal";
import {
  createEmptyPortMapping,
  MAX_PORT_MAPPINGS,
  PortMappingEditor,
  type PortMappingFormValue,
  validatePortMappings,
} from "./PortMappingEditor";

type SandboxContainerFormModalProps = {
  open: boolean;
  saving: boolean;
  images: SandboxImage[];
  imagesLoading: boolean;
  hosts: ManagedHost[];
  hostsLoading: boolean;
  users: SystemUser[];
  usersLoading: boolean;
  egressProxies: EgressProxy[];
  egressProxiesLoading: boolean;
  optionLoadIssues: ResourceFormLoadIssue[];
  optionsLoading: boolean;
  currentUserId: number;
  onRetryOptions: () => void;
  onCancel: () => void;
  onSubmit: (payload: CreateSandboxContainerRequest) => Promise<void>;
};

export function SandboxContainerFormModal({
  open,
  saving,
  images,
  imagesLoading,
  hosts,
  hostsLoading,
  users,
  usersLoading,
  egressProxies,
  egressProxiesLoading,
  optionLoadIssues,
  optionsLoading,
  currentUserId,
  onRetryOptions,
  onCancel,
  onSubmit,
}: SandboxContainerFormModalProps) {
  const [hostId, setHostId] = useState<number | undefined>();
  const [imageId, setImageId] = useState<number | undefined>();
  const [egressMode, setEgressMode] = useState<SandboxContainerEgressMode>(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
  const [egressProxyId, setEgressProxyId] = useState<number | undefined>();
  const [ownerId, setOwnerId] = useState<number | undefined>();
  const [portMappings, setPortMappings] = useState<PortMappingFormValue[]>([]);
  const selectedImage = useMemo(() => images.find((image) => image.id === imageId), [imageId, images]);
  const portMappingValidation = useMemo(() => validatePortMappings(portMappings), [portMappings]);
  const initialOwnerId = currentUserId > 0 ? currentUserId : undefined;
  const dirty = open && (
    hostId !== undefined
    || imageId !== undefined
    || egressMode !== SANDBOX_CONTAINER_EGRESS_MODE.DIRECT
    || egressProxyId !== undefined
    || (ownerId ?? initialOwnerId) !== initialOwnerId
    || portMappings.length > 0
  );

  useEffect(() => {
    if (!open) return;
    setHostId(undefined);
    setImageId(undefined);
    setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
    setEgressProxyId(undefined);
    setOwnerId(currentUserId > 0 ? currentUserId : undefined);
    setPortMappings([]);
  }, [open, currentUserId]);

  const submit = () => onSubmit({
    host_id: hostId || 0,
    image_id: imageId || 0,
    egress_mode: egressMode,
    egress_proxy_id: egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY ? egressProxyId : undefined,
    owner_id: ownerId !== currentUserId ? ownerId : undefined,
    port_mappings: portMappings.map(({ container_port, host_port, protocol }) => ({
      container_port,
      host_port,
      protocol,
    })),
  });

  const updateMapping = (id: string, patch: Partial<PortMappingFormValue>) => {
    setPortMappings((current) => current.map((mapping) => (
      mapping.id === id ? { ...mapping, ...patch } : mapping
    )));
  };

  const removeMapping = (id: string) => {
    setPortMappings((current) => current.filter((item) => item.id !== id));
  };

  const addMapping = () => {
    setPortMappings((current) => (
      current.length >= MAX_PORT_MAPPINGS ? current : [...current, createEmptyPortMapping()]
    ));
  };

  const selectImage = (value: unknown) => {
    if (typeof value !== "number") return;
    const nextImage = images.find((image) => image.id === value);
    setImageId(value);
    if (!nextImage?.supports_tor && egressMode === SANDBOX_CONTAINER_EGRESS_MODE.TOR) {
      setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
    }
  };

  const submitDisabled = (
    !hostId
    || !imageId
    || (egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY && !egressProxyId)
    || (egressMode === SANDBOX_CONTAINER_EGRESS_MODE.TOR && !selectedImage?.supports_tor)
    || !portMappingValidation.isValid
  );

  return (
    <ResourceModal
      open={open}
      title="创建执行工作区"
      saving={saving}
      dirty={dirty}
      submitLabel="创建"
      submitDisabled={submitDisabled}
      width={640}
      className="sandbox-container-form-modal"
      onCancel={onCancel}
      onSubmit={submit}
    >
      <ResourceFormLoadError
        issues={optionLoadIssues}
        loading={optionsLoading}
        onRetry={onRetryOptions}
      />
      <label>
        <span>运行主机</span>
        <Select
          prefix={<Server size={16} />}
          aria-label="运行主机"
          value={hostId}
          loading={hostsLoading}
          disabled={hosts.length === 0}
          placeholder="选择运行主机"
          onChange={(value) => typeof value === "number" && setHostId(value)}
          optionList={hosts.map((host) => ({
            label: host.id === 1
              ? `${host.display_name || "本机"} · 本地执行`
              : `SSH · ${host.display_name || host.ip_address} · ${host.host_account}@${host.ip_address}:${host.ssh_port}`,
            value: host.id,
          }))}
        />
        {!hostsLoading && hosts.length === 0 ? (
          <small className="resource-field-error" role="status">暂无可用主机，请先添加运行主机</small>
        ) : null}
      </label>

      <label>
        <span>工具基线</span>
        <Select
          prefix={<Boxes size={16} />}
          aria-label="工具基线"
          value={imageId}
          loading={imagesLoading}
          disabled={images.length === 0}
          placeholder="选择工具基线"
          onChange={selectImage}
          optionList={images.map((image) => ({
            label: `${image.image_name} · 控制端口 ${image.control_proxy_port}`,
            value: image.id,
          }))}
        />
        {!imagesLoading && images.length === 0 ? (
          <small className="resource-field-error" role="status">暂无工具基线，请先创建工具基线</small>
        ) : null}
      </label>

      <label>
        <span>所有者</span>
        <Select
          prefix={<User size={16} />}
          aria-label="所有者"
          value={ownerId}
          loading={usersLoading}
          placeholder={usersLoading ? "正在加载所有者" : "默认当前用户"}
          emptyContent="暂无其他可选用户"
          showClear
          onClear={() => setOwnerId(undefined)}
          onChange={(value) => typeof value === "number" && setOwnerId(value)}
          optionList={users.map((u) => ({ label: u.username, value: u.id }))}
        />
      </label>

      <label>
        <span>网络出口模式</span>
        <Select
          prefix={<Route size={16} />}
          aria-label="网络出口模式"
          value={egressMode}
          optionList={[
            { label: "直连", value: SANDBOX_CONTAINER_EGRESS_MODE.DIRECT },
            { label: "出口代理", value: SANDBOX_CONTAINER_EGRESS_MODE.PROXY },
            { label: "Tor 代理", value: SANDBOX_CONTAINER_EGRESS_MODE.TOR, disabled: !selectedImage?.supports_tor },
          ]}
          onChange={(value) => {
            if (typeof value !== "string") return;
            const next = value as SandboxContainerEgressMode;
            setEgressMode(next);
            if (next !== SANDBOX_CONTAINER_EGRESS_MODE.PROXY) setEgressProxyId(undefined);
          }}
        />
      </label>

      {egressMode === SANDBOX_CONTAINER_EGRESS_MODE.PROXY ? (
        <label>
          <span>出口代理</span>
          <Select
            prefix={<Network size={16} />}
            aria-label="出口代理"
            value={egressProxyId}
            loading={egressProxiesLoading}
            placeholder="选择出口代理"
            emptyContent="暂无出口代理"
            onChange={(value) => setEgressProxyId(typeof value === "number" ? value : undefined)}
            optionList={egressProxies.map((proxy) => ({ label: egressProxyOptionLabel(proxy), value: proxy.id }))}
          />
        </label>
      ) : null}

      <PortMappingEditor
        mappings={portMappings}
        onAdd={addMapping}
        onRemove={removeMapping}
        onChange={updateMapping}
      />
    </ResourceModal>
  );
}

function egressProxyOptionLabel(proxy: EgressProxy) {
  return `${proxy.proxy_type}://${proxy.proxy_host}:${proxy.proxy_port}`;
}

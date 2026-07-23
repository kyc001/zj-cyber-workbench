import { Select, Spin } from "@douyinfe/semi-ui";
import { Boxes, Route, Server } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSandboxContainer, getSandboxContainerCreateOptions } from "../../shared/api/sandboxContainers";
import { SANDBOX_CONTAINER_EGRESS_MODE } from "../../shared/api/generated/constants";
import { getApiErrorMessage, showApiError, showApiSuccess } from "../../shared/api/feedback";
import type {
  SandboxContainer,
  SandboxContainerEgressMode,
  SandboxContainerHostOption,
  SandboxImage,
} from "../../shared/api/types";
import { ResourceFormLoadError, ResourceModal } from "../../shared/components/ResourceModal";

type PlaygroundSandboxCreateModalProps = {
  open: boolean;
  onCancel: () => void;
  onCreated: (container: SandboxContainer) => void;
};

export function PlaygroundSandboxCreateModal({ open, onCancel, onCreated }: PlaygroundSandboxCreateModalProps) {
  const [hosts, setHosts] = useState<SandboxContainerHostOption[]>([]);
  const [images, setImages] = useState<SandboxImage[]>([]);
  const [hostId, setHostId] = useState<number | undefined>();
  const [imageId, setImageId] = useState<number | undefined>();
  const [egressMode, setEgressMode] = useState<SandboxContainerEgressMode>(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const selectedImage = useMemo(() => images.find((image) => image.id === imageId) ?? null, [imageId, images]);
  const dirty = open && (
    hostId !== undefined
    || imageId !== undefined
    || egressMode !== SANDBOX_CONTAINER_EGRESS_MODE.DIRECT
  );

  useEffect(() => {
    if (!open) {
      setHosts([]);
      setImages([]);
      setHostId(undefined);
      setImageId(undefined);
      setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
      setLoadError("");
      setLoading(false);
      return;
    }
    setHosts([]);
    setImages([]);
    setHostId(undefined);
    setImageId(undefined);
    setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
    setLoadError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    getSandboxContainerCreateOptions()
      .then((response) => {
        if (!active) return;
        const options = response.data;
        if (!options) throw new Error("创建选项响应不可用");
        setHosts(options.hosts);
        setImages(options.images);
        setHostId((current) => (
          current && options.hosts.some((host) => host.id === current) ? current : undefined
        ));
        setImageId((current) => (
          current && options.images.some((image) => image.id === current) ? current : undefined
        ));
      })
      .catch((error) => {
        if (active) setLoadError(getApiErrorMessage(error, "加载创建选项失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, reloadVersion]);

  const submit = async () => {
    if (savingRef.current || !hostId || !imageId) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await createSandboxContainer({
        host_id: hostId,
        image_id: imageId,
        egress_mode: egressMode,
        port_mappings: [],
      });
      if (!response.data) throw new Error("创建响应未包含执行工作区");
      showApiSuccess(response);
      onCreated(response.data);
    } catch (error) {
      showApiError(error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const submitDisabled = (
    loading
    || Boolean(loadError)
    || !hostId
    || !imageId
    || (egressMode === SANDBOX_CONTAINER_EGRESS_MODE.TOR && !selectedImage?.supports_tor)
  );

  return (
    <ResourceModal
      open={open}
      title="创建执行工作区"
      saving={saving}
      dirty={dirty}
      submitLabel="创建"
      submitDisabled={submitDisabled}
      width={520}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <ResourceFormLoadError
        issues={loadError ? [{ label: "创建选项", message: loadError }] : []}
        loading={loading}
        onRetry={() => setReloadVersion((version) => version + 1)}
      />
      <label>
        <span>运行主机</span>
        <Select
          prefix={<Server size={16} />}
          value={hostId}
          loading={loading}
          disabled={loading || hosts.length === 0}
          aria-label="运行主机"
          placeholder={loading ? "正在加载主机" : "选择运行主机"}
          emptyContent={loading ? <Spin size="small" /> : "暂无主机"}
          optionList={hosts.map((host) => ({
            label: host.execution_backend === "local"
              ? `${host.display_name || "本机"} · 本地执行`
              : `SSH · ${host.display_name || host.ip_address} · ${host.host_account}@${host.ip_address}:${host.ssh_port}`,
            value: host.id,
          }))}
          onChange={(value) => typeof value === "number" && setHostId(value)}
        />
        {!loading && !loadError && hosts.length === 0 ? (
          <small className="resource-field-error" role="status">暂无可用主机，请先在主机管理中添加</small>
        ) : null}
      </label>

      <label>
        <span>工具基线</span>
        <Select
          prefix={<Boxes size={16} />}
          value={imageId}
          loading={loading}
          disabled={loading || images.length === 0}
          aria-label="工具基线"
          placeholder={loading ? "正在加载工具基线" : "选择工具基线"}
          emptyContent={loading ? <Spin size="small" /> : "暂无工具基线"}
          optionList={images.map((image) => ({
            label: `${image.image_name} · 控制端口 ${image.control_proxy_port}`,
            value: image.id,
          }))}
          onChange={(value) => {
            if (typeof value !== "number") return;
            const nextImage = images.find((image) => image.id === value) ?? null;
            setImageId(value);
            if (!nextImage?.supports_tor && egressMode === SANDBOX_CONTAINER_EGRESS_MODE.TOR) {
              setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
            }
          }}
        />
        {!loading && !loadError && images.length === 0 ? (
          <small className="resource-field-error" role="status">暂无工具基线，请先创建工具基线</small>
        ) : null}
      </label>

      <label>
        <span>网络出口模式</span>
        <Select
          prefix={<Route size={16} />}
          value={egressMode}
          aria-label="网络出口模式"
          optionList={[
            { label: "直连", value: SANDBOX_CONTAINER_EGRESS_MODE.DIRECT },
            { label: "Tor 代理", value: SANDBOX_CONTAINER_EGRESS_MODE.TOR, disabled: !selectedImage?.supports_tor },
          ]}
          onChange={(value) => {
            if (typeof value === "string") setEgressMode(value as SandboxContainerEgressMode);
          }}
        />
      </label>
    </ResourceModal>
  );
}

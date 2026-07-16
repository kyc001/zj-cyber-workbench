import { Select, Spin } from "@douyinfe/semi-ui";
import { Boxes, Route, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createSandboxContainer, getSandboxContainerCreateOptions } from "../../shared/api/sandboxContainers";
import { SANDBOX_CONTAINER_EGRESS_MODE } from "../../shared/api/generated/constants";
import { showApiError, showApiSuccess } from "../../shared/api/feedback";
import type {
  SandboxContainer,
  SandboxContainerEgressMode,
  SandboxContainerHostOption,
  SandboxImage,
} from "../../shared/api/types";
import { ResourceModal } from "../../shared/components/ResourceModal";

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
  const [saving, setSaving] = useState(false);
  const selectedImage = useMemo(() => images.find((image) => image.id === imageId) ?? null, [imageId, images]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setHostId(undefined);
    setImageId(undefined);
    setEgressMode(SANDBOX_CONTAINER_EGRESS_MODE.DIRECT);
    setLoading(true);
    getSandboxContainerCreateOptions()
      .then((response) => {
        if (!active) return;
        const options = response.data;
        setHosts(options?.hosts ?? []);
        setImages(options?.images ?? []);
      })
      .catch((error) => {
        if (active) showApiError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const submit = async () => {
    if (!hostId || !imageId) return;
    setSaving(true);
    try {
      const response = await createSandboxContainer({
        host_id: hostId,
        image_id: imageId,
        egress_mode: egressMode,
        port_mappings: [],
      });
      if (response.data) {
        showApiSuccess(response);
        onCreated(response.data);
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const submitDisabled = (
    loading
    || !hostId
    || !imageId
    || (egressMode === SANDBOX_CONTAINER_EGRESS_MODE.TOR && !selectedImage?.supports_tor)
  );

  return (
    <ResourceModal
      open={open}
      title="创建执行工作区"
      saving={saving}
      submitLabel="创建"
      submitDisabled={submitDisabled}
      width={520}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <label>
        <span>运行主机</span>
        <Select
          prefix={<Server size={16} />}
          value={hostId}
          loading={loading}
          disabled={loading || hosts.length === 0}
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
      </label>

      <label>
        <span>工具基线</span>
        <Select
          prefix={<Boxes size={16} />}
          value={imageId}
          loading={loading}
          disabled={loading || images.length === 0}
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
      </label>

      <label>
        <span>网络出口模式</span>
        <Select
          prefix={<Route size={16} />}
          value={egressMode}
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

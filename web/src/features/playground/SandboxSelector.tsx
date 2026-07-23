import { Select, Spin, Tag, Tooltip } from "@douyinfe/semi-ui";
import { Box } from "lucide-react";
import type { SandboxContainer } from "../../shared/api/types";
import { cx } from "../../shared/lib/className";
import { SANDBOX_CONTAINER_STATUS_COLOR, SANDBOX_CONTAINER_STATUS_LABEL } from "../../shared/lib/labels";

type SandboxSelectorProps = {
  containers: SandboxContainer[];
  loading: boolean;
  updating?: boolean;
  error?: string;
  value: number | null;
  className?: string;
  disabled?: boolean;
  onChange: (containerId: number | null) => void;
};

const CONTAINER_ID_PREVIEW_LENGTH = 12;

function parseContainerId(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function SandboxSelector({
  containers,
  loading,
  updating = false,
  error = "",
  value,
  className = "",
  disabled = false,
  onChange,
}: SandboxSelectorProps) {
  const optionList = containers.map((container) => ({
    label: renderContainerOption(container),
    value: container.id,
  }));
  const selectedContainer = containers.find((container) => container.id === value) ?? null;

  return (
    <div className={cx("sandbox-selector", error && "sandbox-selector-error", className)} title={error || undefined}>
      <Select
        prefix={<Box size={15} />}
        aria-label="执行工作区"
        value={value ?? undefined}
        optionList={optionList}
        renderSelectedItem={() => selectedContainer ? renderSelectedContainer(selectedContainer) : ""}
        loading={loading || updating}
        placeholder={loading ? "正在加载执行工作区" : error ? "执行工作区加载失败" : "选择执行工作区"}
        emptyContent={loading ? <Spin size="small" /> : error || "暂无可用工作区"}
        disabled={disabled || loading || updating || containers.length === 0}
        showClear={!disabled}
        onClear={() => onChange(null)}
        onChange={(nextValue) => onChange(parseContainerId(nextValue))}
      />
    </div>
  );
}

function renderContainerOption(container: SandboxContainer) {
  return (
    <div className="sandbox-selector-option">
      <span>{renderExecutionLocationLabel(container)}</span>
      <small>{container.image_name} · 工作区ID：{renderContainerId(container.container_hash)}</small>
      <Tag color={SANDBOX_CONTAINER_STATUS_COLOR[container.status]}>
        {SANDBOX_CONTAINER_STATUS_LABEL[container.status]}
      </Tag>
    </div>
  );
}

function renderSelectedContainer(container: SandboxContainer) {
  const fullLabel = renderExecutionLocationLabel(container);
  return (
    <Tooltip content={fullLabel}>
      <span className="sandbox-selector-selected">{renderCompactExecutionLocationLabel(container)}</span>
    </Tooltip>
  );
}

function renderExecutionLocationLabel(container: SandboxContainer) {
  const status = SANDBOX_CONTAINER_STATUS_LABEL[container.status];
  if (container.host_execution_backend === "local") {
    return `本机 · 本地执行 · ${status}`;
  }
  const hostName = container.host_display_name || "SSH主机";
  return `SSH · ${hostName} · ${container.host_account}@${container.host_ip_address}:${container.host_ssh_port} · ${status}`;
}

function renderCompactExecutionLocationLabel(container: SandboxContainer) {
  const status = SANDBOX_CONTAINER_STATUS_LABEL[container.status];
  if (container.host_execution_backend === "local") {
    return `本机 · ${status}`;
  }
  const hostName = container.host_display_name || container.host_ip_address || "SSH主机";
  return `SSH · ${hostName} · ${status}`;
}

function renderContainerId(containerHash: string) {
  if (!containerHash) return "等待创建";
  return containerHash.slice(0, CONTAINER_ID_PREVIEW_LENGTH);
}

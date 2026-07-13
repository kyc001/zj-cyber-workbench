import { Select, Spin, Tag } from "@douyinfe/semi-ui";
import { Box } from "lucide-react";
import type { SandboxContainer } from "../../shared/api/types";
import { cx } from "../../shared/lib/className";
import { SANDBOX_CONTAINER_STATUS_COLOR, SANDBOX_CONTAINER_STATUS_LABEL } from "../../shared/lib/labels";

type SandboxSelectorProps = {
  containers: SandboxContainer[];
  loading: boolean;
  value: number | null;
  className?: string;
  disabled?: boolean;
  onChange: (containerId: number | null) => void;
};

const CONTAINER_ID_PREVIEW_LENGTH = 12;

export function SandboxSelector({ containers, loading, value, className = "", disabled = false, onChange }: SandboxSelectorProps) {
  const optionList = containers.map((container) => ({
        label: renderContainerOption(container),
    value: container.id,
  }));
  const selectedContainer = containers.find((container) => container.id === value) ?? null;

  return (
    <div className={cx("sandbox-selector", className)}>
      <Select
        prefix={<Box size={15} />}
        value={value ?? undefined}
        optionList={optionList}
        renderSelectedItem={() => renderContainerId(selectedContainer?.container_hash ?? "")}
        placeholder={loading ? "正在加载执行工作区" : "选择执行工作区"}
        emptyContent={loading ? <Spin size="small" /> : "暂无可用工作区"}
        disabled={disabled || loading || containers.length === 0}
        showClear={!disabled}
        onClear={() => onChange(null)}
        onChange={(nextValue) => onChange(typeof nextValue === "number" ? nextValue : null)}
      />
    </div>
  );
}

function renderContainerOption(container: SandboxContainer) {
  return (
    <div className="sandbox-selector-option">
      <span>{container.container_name}</span>
      <small>工作区标识：{renderContainerId(container.container_hash)}</small>
      <Tag color={SANDBOX_CONTAINER_STATUS_COLOR[container.status]}>
        {SANDBOX_CONTAINER_STATUS_LABEL[container.status]}
      </Tag>
    </div>
  );
}

function renderContainerId(containerHash: string) {
  if (!containerHash) return "等待创建";
  return containerHash.slice(0, CONTAINER_ID_PREVIEW_LENGTH);
}

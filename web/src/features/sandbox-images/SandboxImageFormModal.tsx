import { Input, InputNumber, Select } from "@douyinfe/semi-ui";
import { Network, Package, Route } from "lucide-react";
import { useEffect, useState } from "react";
import type { CreateSandboxImageRequest } from "../../shared/api/types";
import { ResourceModal } from "../../shared/components/ResourceModal";

type SandboxImageFormModalProps = {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (payload: CreateSandboxImageRequest) => Promise<void>;
};

const EMPTY: CreateSandboxImageRequest = {
  image_name: "zj-portable-tools",
  control_proxy_port: 8000,
  supports_tor: false,
};

export function SandboxImageFormModal({ open, saving, onCancel, onSubmit }: SandboxImageFormModalProps) {
  const [values, setValues] = useState<CreateSandboxImageRequest>(EMPTY);
  const dirty = open && JSON.stringify(values) !== JSON.stringify(EMPTY);
  const invalidPort = !Number.isInteger(values.control_proxy_port)
    || values.control_proxy_port < 1
    || values.control_proxy_port > 65535;

  useEffect(() => {
    if (open) setValues(EMPTY);
  }, [open]);

  return (
    <ResourceModal
      open={open}
      title="创建工具基线"
      saving={saving}
      dirty={dirty}
      submitLabel="创建"
      submitDisabled={!values.image_name.trim() || invalidPort}
      onCancel={onCancel}
      onSubmit={() => onSubmit({
        image_name: values.image_name.trim(),
        control_proxy_port: values.control_proxy_port,
        supports_tor: values.supports_tor,
      })}
    >
      <label>
        <span>基线名称</span>
        <Input prefix={<Package size={16} />} value={values.image_name}
          placeholder="例如 zj-portable-tools" maxLength={255} required
          onChange={(image_name) => setValues((current) => ({ ...current, image_name }))}
        />
      </label>
      <label>
        <span>兼容控制端口</span>
        <InputNumber
          prefix={<Network size={16} />}
          value={values.control_proxy_port}
          min={1}
          max={65535}
          aria-invalid={invalidPort}
          onChange={(control_proxy_port) => {
            if (typeof control_proxy_port === "number") setValues((current) => ({ ...current, control_proxy_port }));
          }}
        />
        {invalidPort ? <small className="resource-field-error" role="status">端口必须是 1–65535 之间的整数</small> : null}
      </label>
      <label>
        <span>Tor 代理能力</span>
        <Select
          prefix={<Route size={16} />}
          value={values.supports_tor ? "supported" : "unsupported"}
          optionList={[
            { label: "不支持", value: "unsupported" },
            { label: "支持", value: "supported" },
          ]}
          onChange={(value) => {
            if (value === "supported" || value === "unsupported") {
              setValues((current) => ({ ...current, supports_tor: value === "supported" }));
            }
          }}
        />
      </label>
    </ResourceModal>
  );
}

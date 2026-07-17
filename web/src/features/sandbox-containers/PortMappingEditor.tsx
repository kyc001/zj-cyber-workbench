import { Button, InputNumber, Select } from "@douyinfe/semi-ui";
import { Plug, Plus, Trash2 } from "lucide-react";
import type { SandboxContainerPortMapping } from "../../shared/api/types";
import { createClientId } from "../../shared/lib/id";


export type PortMappingFormValue = SandboxContainerPortMapping & {
  id: string;
};

type PortMappingEditorProps = {
  mappings: PortMappingFormValue[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<PortMappingFormValue>) => void;
};

const PROTOCOL_OPTIONS = [
  { label: "TCP", value: "tcp" },
  { label: "UDP", value: "udp" },
];

export function createEmptyPortMapping(): PortMappingFormValue {
  return {
    id: createClientId("port-mapping"),
    container_port: 8080,
    host_port: 8080,
    protocol: "tcp",
  };
}

export function PortMappingEditor({
  mappings,
  onAdd,
  onRemove,
  onChange,
}: PortMappingEditorProps) {
  return (
    <div className="port-mapping-fieldset">
      <div className="port-mapping-heading">
        <span>端口映射</span>
        <div className="port-mapping-actions">
          <Button icon={<Plus size={14} />} theme="borderless" type="tertiary" onClick={onAdd}>
            添加
          </Button>
        </div>
      </div>
      {mappings.length === 0 ? (
        <div className="port-mapping-empty">未暴露端口</div>
      ) : mappings.map((mapping) => (
        <div className="port-mapping-row" key={mapping.id}>
          <InputNumber
            prefix={<Plug size={14} />}
            value={mapping.host_port}
            min={1}
            max={65535}
            onChange={(value) => typeof value === "number" && onChange(mapping.id, { host_port: value })}
          />
          <span className="port-arrow">到</span>
          <InputNumber
            value={mapping.container_port}
            min={1}
            max={65535}
            onChange={(value) => typeof value === "number" && onChange(mapping.id, { container_port: value })}
          />
          <Select
            value={mapping.protocol}
            optionList={PROTOCOL_OPTIONS}
            onChange={(value) => (value === "tcp" || value === "udp") && onChange(mapping.id, { protocol: value })}
          />
          <Button
            icon={<Trash2 size={14} />}
            theme="borderless"
            type="danger"
            aria-label="移除端口映射"
            onClick={() => onRemove(mapping.id)}
          />
        </div>
      ))}
    </div>
  );
}

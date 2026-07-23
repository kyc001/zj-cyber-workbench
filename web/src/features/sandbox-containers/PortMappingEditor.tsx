import { Button, InputNumber, Select } from "@douyinfe/semi-ui";
import { Plug, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { SandboxContainerPortMapping } from "../../shared/api/types";
import { createClientId } from "../../shared/lib/id";


export type PortMappingFormValue = SandboxContainerPortMapping & {
  id: string;
};

export type PortMappingValidation = {
  isValid: boolean;
  limitReached: boolean;
  errors: Readonly<Record<string, string[]>>;
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
export const MAX_PORT_MAPPINGS = 32;

export function validatePortMappings(
  mappings: PortMappingFormValue[],
  maxMappings = MAX_PORT_MAPPINGS,
): PortMappingValidation {
  const errors: Record<string, string[]> = {};
  const hostPorts = new Map<string, string[]>();
  const containerPorts = new Map<string, string[]>();
  const addError = (id: string, message: string) => {
    const messages = errors[id] ?? [];
    if (!messages.includes(message)) errors[id] = [...messages, message];
  };
  const collect = (map: Map<string, string[]>, key: string, id: string) => {
    map.set(key, [...(map.get(key) ?? []), id]);
  };

  mappings.forEach((mapping) => {
    if (!isValidPort(mapping.host_port)) addError(mapping.id, "宿主端口必须是 1–65535 之间的整数");
    if (!isValidPort(mapping.container_port)) addError(mapping.id, "容器端口必须是 1–65535 之间的整数");
    collect(hostPorts, `${mapping.protocol}:${mapping.host_port}`, mapping.id);
    collect(containerPorts, `${mapping.protocol}:${mapping.container_port}`, mapping.id);
  });
  hostPorts.forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => addError(id, "同一协议下宿主端口不能重复"));
  });
  containerPorts.forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => addError(id, "同一协议下容器端口不能重复"));
  });

  return {
    isValid: mappings.length <= maxMappings && Object.keys(errors).length === 0,
    limitReached: mappings.length >= maxMappings,
    errors,
  };
}

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
  const validation = useMemo(() => validatePortMappings(mappings), [mappings]);

  return (
    <div className="port-mapping-fieldset">
      <div className="port-mapping-heading">
        <span>端口映射</span>
        <div className="port-mapping-actions">
          <Button
            htmlType="button"
            icon={<Plus size={14} />}
            theme="borderless"
            type="tertiary"
            disabled={validation.limitReached}
            aria-label="添加端口映射"
            title={validation.limitReached ? `最多添加 ${MAX_PORT_MAPPINGS} 条端口映射` : undefined}
            onClick={onAdd}
          >
            添加
          </Button>
        </div>
      </div>
      {mappings.length === 0 ? (
        <div className="port-mapping-empty">未暴露端口</div>
      ) : mappings.map((mapping, index) => {
        const errors = validation.errors[mapping.id] ?? [];
        const errorId = errors.length > 0 ? `port-mapping-error-${mapping.id}` : undefined;
        return (
        <div className="port-mapping-row" key={mapping.id}>
          <InputNumber
            prefix={<Plug size={14} />}
            value={mapping.host_port}
            min={1}
            max={65535}
            precision={0}
            aria-label={`第 ${index + 1} 条映射的宿主端口`}
            aria-invalid={errors.length > 0}
            aria-describedby={errorId}
            onChange={(value) => typeof value === "number" && onChange(mapping.id, { host_port: value })}
          />
          <span className="port-arrow">到</span>
          <InputNumber
            value={mapping.container_port}
            min={1}
            max={65535}
            precision={0}
            aria-label={`第 ${index + 1} 条映射的容器端口`}
            aria-invalid={errors.length > 0}
            aria-describedby={errorId}
            onChange={(value) => typeof value === "number" && onChange(mapping.id, { container_port: value })}
          />
          <Select
            value={mapping.protocol}
            aria-label={`第 ${index + 1} 条映射的协议`}
            optionList={PROTOCOL_OPTIONS}
            onChange={(value) => (value === "tcp" || value === "udp") && onChange(mapping.id, { protocol: value })}
          />
          <Button
            htmlType="button"
            icon={<Trash2 size={14} />}
            theme="borderless"
            type="danger"
            aria-label={`移除第 ${index + 1} 条端口映射`}
            onClick={() => onRemove(mapping.id)}
          />
          {errors.length > 0 ? (
            <small id={errorId} className="port-mapping-error" role="status">
              {errors.join("；")}
            </small>
          ) : null}
        </div>
        );
      })}
      {validation.limitReached ? (
        <small className="port-mapping-limit" role="status">
          已达到 {MAX_PORT_MAPPINGS} 条端口映射上限
        </small>
      ) : null}
    </div>
  );
}

function isValidPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

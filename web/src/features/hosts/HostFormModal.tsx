import { Input, InputNumber } from "@douyinfe/semi-ui";
import { KeyRound, Network, Server, Tag, User } from "lucide-react";
import { useEffect, useState } from "react";
import type { CreateManagedHostRequest, ManagedHost, UpdateManagedHostRequest } from "../../shared/api/types";
import { ResourceModal } from "../../shared/components/ResourceModal";

type HostFormValues = CreateManagedHostRequest;

const DEFAULT_LOCAL_HOST_ID = 1;

type HostFormModalProps = {
  open: boolean;
  host: ManagedHost | null;
  saving: boolean;
  onCancel: () => void;
  onCreate: (payload: CreateManagedHostRequest) => Promise<void>;
  onUpdate: (host: ManagedHost, payload: UpdateManagedHostRequest) => Promise<void>;
};

const EMPTY: HostFormValues = {
  display_name: "",
  ip_address: "",
  ssh_port: 22,
  host_account: "root",
  host_password: "",
};

function initial(host: ManagedHost | null): HostFormValues {
  if (!host) return EMPTY;
  return {
    display_name: host.display_name,
    ip_address: host.ip_address,
    ssh_port: host.ssh_port,
    host_account: host.host_account,
    host_password: "",
  };
}

export function HostFormModal({ open, host, saving, onCancel, onCreate, onUpdate }: HostFormModalProps) {
  const [values, setValues] = useState<HostFormValues>(() => initial(host));
  const editing = Boolean(host);
  const isLocalHostEdit = host?.id === DEFAULT_LOCAL_HOST_ID;
  const dirty = open && JSON.stringify(values) !== JSON.stringify(initial(host));
  const invalidAddress = !isLocalHostEdit && Boolean(values.ip_address.trim()) && !isValidIpAddress(values.ip_address);

  useEffect(() => {
    if (open) setValues(initial(host));
  }, [open, host]);

  const setValue = <K extends keyof HostFormValues>(field: K, value: HostFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    const hostPayload = {
      display_name: values.display_name.trim(),
      ip_address: values.ip_address.trim(),
      ssh_port: values.ssh_port,
      host_account: values.host_account.trim(),
      host_password: values.host_password,
    };
    if (!host) {
      await onCreate(hostPayload);
      return;
    }

    await onUpdate(host, {
      display_name: hostPayload.display_name,
      ...(isLocalHostEdit ? {} : {
      ip_address: hostPayload.ip_address,
      ssh_port: hostPayload.ssh_port,
      host_account: hostPayload.host_account,
      ...(hostPayload.host_password ? { host_password: hostPayload.host_password } : {}),
      }),
    });
  };

  const submitDisabled = (
    (!isLocalHostEdit && (
      !values.ip_address.trim()
      || invalidAddress
      || !values.host_account.trim()
      || (!editing && !values.host_password)
      || invalidPort(values.ssh_port)
    ))
    || (editing && !dirty)
  );

  return (
    <ResourceModal
      open={open}
      title={editing ? "编辑主机" : "添加 SSH 主机"}
      saving={saving}
      dirty={dirty}
      submitLabel={editing ? "保存" : "添加"}
      submitDisabled={submitDisabled}
      width={640}
      className="host-form-modal"
      onCancel={onCancel}
      onSubmit={submit}
    >
      <div className="host-form-row">
        <label>
          <span>主机名称</span>
          <Input prefix={<Tag size={16} />} value={values.display_name} maxLength={128}
            placeholder="例如：WSL测试机"
            autoComplete="off"
            onChange={(value) => setValue("display_name", value)}
          />
        </label>
      </div>
      <div className="host-form-row">
        <label>
          <span>IP 地址</span>
          <Input prefix={<Server size={16} />} value={values.ip_address} maxLength={255} required
            autoComplete="off"
            disabled={isLocalHostEdit}
            aria-invalid={invalidAddress}
            onChange={(value) => setValue("ip_address", value)}
          />
          {invalidAddress ? <small className="resource-field-error" role="status">请输入有效的 IPv4 或 IPv6 地址</small> : null}
        </label>
        <label>
          <span>SSH 端口</span>
          <InputNumber prefix={<Network size={16} />} value={values.ssh_port} min={1} max={65535}
            disabled={isLocalHostEdit}
            onChange={(value) => typeof value === "number" && setValue("ssh_port", value)}
          />
        </label>
      </div>
      <div className="host-form-row">
        <label>
          <span>SSH 账号</span>
          <Input prefix={<User size={16} />} value={values.host_account} maxLength={128} required
            autoComplete="off"
            disabled={isLocalHostEdit}
            onChange={(value) => setValue("host_account", value)}
          />
        </label>
        <label>
          <span>{editing ? "更新 SSH 密码（留空则不变）" : "SSH 密码"}</span>
          <Input mode="password" prefix={<KeyRound size={16} />} value={values.host_password} maxLength={512} required={!editing}
            autoComplete="new-password"
            disabled={isLocalHostEdit}
            onChange={(value) => setValue("host_password", value)}
          />
        </label>
      </div>
    </ResourceModal>
  );
}

function invalidPort(port: number) {
  return !Number.isInteger(port) || port < 1 || port > 65535;
}

function isValidIpAddress(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return false;
  if (!value.includes(":")) {
    const parts = value.split(".");
    return parts.length === 4 && parts.every((part) => (
      /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255
    ));
  }
  if (value.includes("%")) return false;
  try {
    const parsed = new URL(`http://[${value}]/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
}

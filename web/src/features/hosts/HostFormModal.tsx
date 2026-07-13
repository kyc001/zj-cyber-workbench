import { Input, InputNumber } from "@douyinfe/semi-ui";
import { KeyRound, Network, Server, User } from "lucide-react";
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
  ip_address: "",
  ssh_port: 22,
  host_account: "root",
  host_password: "",
};

function initial(host: ManagedHost | null): HostFormValues {
  if (!host) return EMPTY;
  return {
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

  useEffect(() => {
    if (open) setValues(initial(host));
  }, [open, host]);

  const setValue = <K extends keyof HostFormValues>(field: K, value: HostFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    const hostPayload = {
      ip_address: values.ip_address.trim(),
      ssh_port: values.ssh_port,
      host_account: values.host_account.trim(),
      host_password: values.host_password,
    };
    if (!host) {
      await onCreate(hostPayload);
      return;
    }

    await onUpdate(host, isLocalHostEdit ? {} : {
      ip_address: hostPayload.ip_address,
      ssh_port: hostPayload.ssh_port,
      host_account: hostPayload.host_account,
      ...(hostPayload.host_password ? { host_password: hostPayload.host_password } : {}),
    });
  };

  const submitDisabled = (
    (!isLocalHostEdit && (
      !values.ip_address.trim()
      || !values.host_account.trim()
      || (!editing && !values.host_password)
      || invalidPort(values.ssh_port)
    ))
  );

  return (
    <ResourceModal
      open={open}
      title={editing ? "编辑主机" : "添加 SSH 主机"}
      saving={saving}
      submitLabel={editing ? "保存" : "添加"}
      submitDisabled={submitDisabled}
      width={640}
      className="host-form-modal"
      onCancel={onCancel}
      onSubmit={submit}
    >
      <div className="host-form-row">
        <label>
          <span>IP 地址</span>
          <Input prefix={<Server size={16} />} value={values.ip_address} maxLength={255} required
            autoComplete="off"
            disabled={isLocalHostEdit}
            onChange={(value) => setValue("ip_address", value)}
          />
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
  return port < 1 || port > 65535;
}

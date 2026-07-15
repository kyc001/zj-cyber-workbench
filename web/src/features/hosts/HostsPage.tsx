import { Button, Modal, Popconfirm } from "@douyinfe/semi-ui";
import { Pencil, Server, ShieldCheck, SquareTerminal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { showApiError, showApiSuccess } from "../../shared/api/feedback";
import {
  createManagedHost,
  deleteManagedHost,
  previewManagedHostKey,
  queryManagedHosts,
  trustManagedHostKey,
  updateManagedHost,
} from "../../shared/api/hosts";
import type { ManagedHost } from "../../shared/api/types";
import { ResourcePageShell } from "../../shared/components/ResourcePageShell";
import { ResourceTable, type ResourceColumn } from "../../shared/components/ResourceTable";
import { OwnerCell, ResourceIdentity, RowActions } from "../../shared/components/ResourceCells";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";
import { usePagedResourceList } from "../../shared/hooks/usePagedResourceList";
import { useResourceAction } from "../../shared/hooks/useResourceAction";
import { useResourceSubmit } from "../../shared/hooks/useResourceSubmit";
import { formatDateTime } from "../../shared/lib/date";
import { UI_TEXT } from "../../shared/lib/uiText";
import { useContainerShell } from "../container-shell/ContainerShellProvider";
import { HostFormModal } from "./HostFormModal";

type ModalState = { mode: "create" } | { mode: "edit"; host: ManagedHost } | null;
const DEFAULT_LOCAL_HOST_ID = 1;

export function HostsPage() {
  const {
    items: hosts, page, keyword, loading, loadItems: loadHosts, total, rangeStart, rangeEnd,
    setKeyword, search, previous, next, canGoBack, canGoNext,
  } = usePagedResourceList<ManagedHost>({ query: queryManagedHosts });
  const [modal, setModal] = useState<ModalState>(null);
  const [trustingHostId, setTrustingHostId] = useState<number | null>(null);
  const { openHostShell } = useContainerShell();
  const { run: deleteHost, busyId: deletingHostId } = useResourceAction<ManagedHost>(
    (host) => deleteManagedHost(host.id),
    loadHosts,
  );

  useAdminResourceHeader({
    createLabel: "添加主机",
    refreshLabel: "刷新主机",
    loading,
    onCreate: () => setModal({ mode: "create" }),
    onRefresh: loadHosts,
  });

  const { saving, submit } = useResourceSubmit({
    onSuccess: async () => {
      setModal(null);
      await loadHosts();
    },
  });

  const trustHostKey = async (host: ManagedHost) => {
    setTrustingHostId(host.id);
    try {
      const response = await previewManagedHostKey(host.id);
      const key = response.data;
      if (!key) return;
      Modal.confirm({
        title: "信任 SSH Host Key",
        okText: key.trusted ? "重新信任当前指纹" : "信任当前指纹",
        cancelText: UI_TEXT.cancel,
        content: (
          <div className="host-key-confirm">
            <p>请确认这是目标主机当前 SSH 指纹。确认后会写入本机 known_hosts。</p>
            <dl>
              <dt>Endpoint</dt>
              <dd>{key.endpoint}</dd>
              <dt>算法</dt>
              <dd>{key.algorithm}</dd>
              <dt>SHA256 指纹</dt>
              <dd>{key.fingerprint_sha256}</dd>
            </dl>
            <pre>{key.public_key}</pre>
          </div>
        ),
        onOk: async () => {
          try {
            const trusted = await trustManagedHostKey(host.id, key.fingerprint_sha256);
            showApiSuccess(trusted);
          } catch (error) {
            showApiError(error);
            throw error;
          }
        },
      });
    } catch (error) {
      showApiError(error);
    } finally {
      setTrustingHostId(null);
    }
  };

  const summary = useMemo(
    () => hosts.reduce(
      (acc, host) => ({
        ssh: acc.ssh + (host.ssh_port > 0 ? 1 : 0),
      }),
      { ssh: 0 },
    ),
    [hosts],
  );

  const columns: ResourceColumn<ManagedHost>[] = [
    {
      key: "host", header: "主机", width: "minmax(0, 0.7fr)",
      render: (host) => (
        <ResourceIdentity icon={<Server size={18} />} title={host.ip_address} detail={`SSH ${host.ssh_port}`} />
      ),
    },
    {
      key: "account", header: "账号", width: "minmax(0, 0.5fr)",
      render: (host) => <OwnerCell>{host.host_account}</OwnerCell>,
    },
    {
      key: "password", header: "密码", width: "minmax(0, 0.6fr)",
      render: (host) => <OwnerCell>{host.has_password ? "已配置" : "未配置"}</OwnerCell>,
    },
    { key: "updated", header: "更新时间", width: "minmax(0, 0.7fr)", render: (host) => formatDateTime(host.updated_at) },
    {
      key: "actions", header: "操作", width: "140px",
      render: (host) => (
        <RowActions>
          <Button icon={<SquareTerminal size={15} />} theme="borderless" type="tertiary"
            aria-label={`Connect shell for ${host.ip_address}`} onClick={() => openHostShell(host)}
          />
          <Button icon={<ShieldCheck size={15} />} theme="borderless" type="tertiary"
            disabled={host.id === DEFAULT_LOCAL_HOST_ID}
            loading={trustingHostId === host.id}
            aria-label={`Trust host key for ${host.ip_address}`}
            onClick={() => void trustHostKey(host)}
          />
          <Button icon={<Pencil size={15} />} theme="borderless" type="tertiary"
            aria-label={`Edit ${host.ip_address}`} onClick={() => setModal({ mode: "edit", host })}
          />
          <Popconfirm title="删除主机" content={`确定删除 ${host.ip_address}？`} okType="danger" cancelText={UI_TEXT.cancel} onConfirm={() => void deleteHost(host)}>
            <Button icon={<Trash2 size={15} />} theme="borderless" type="danger"
              loading={deletingHostId === host.id} aria-label={`Delete ${host.ip_address}`}
            />
          </Popconfirm>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <ResourcePageShell
        searchPlaceholder="搜索 IP、账号或 SSH 端口"
        keyword={keyword}
        loading={loading}
        metrics={[
          { label: "总数", value: total },
          { label: "SSH", value: summary.ssh },
        ]}
        empty={hosts.length === 0}
        emptyIcon={<Server size={42} />}
        emptyTitle="未找到主机"
        page={page}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        total={total}
        canGoBack={canGoBack}
        canGoNext={canGoNext}
        onKeywordChange={setKeyword}
        onSearch={search}
        onPrevious={previous}
        onNext={next}
      >
        <ResourceTable<ManagedHost>
          ariaLabel="主机列表"
          columns={columns}
          rows={hosts}
          rowKey={(host) => host.id}
        />
      </ResourcePageShell>

      <HostFormModal
        open={Boolean(modal)}
        host={modal?.mode === "edit" ? modal.host : null}
        saving={saving}
        onCancel={() => setModal(null)}
        onCreate={(payload) => submit(() => createManagedHost(payload))}
        onUpdate={(host, payload) => submit(() => updateManagedHost(host.id, payload))}
      />
    </>
  );
}

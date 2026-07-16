import { Button, Modal, Select, Tag, Toast } from "@douyinfe/semi-ui";
import { Shield, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decideRuntimePermission,
  getPendingRuntimePermissions,
  getRuntimePermissionSettings,
  updateRuntimePermissionSettings,
} from "../../shared/api/runtimePermissions";
import { showApiError } from "../../shared/api/feedback";
import type {
  PermissionMode,
  RuntimePermissionDecision,
  RuntimePermissionRequest,
} from "../../shared/api/types";

const MODE_OPTIONS = [
  { label: "普通访问", value: "normal" },
  { label: "完全访问", value: "full_access" },
];

export function RuntimePermissionControl() {
  const [mode, setMode] = useState<PermissionMode>("normal");
  const [loadingMode, setLoadingMode] = useState(false);
  const [pending, setPending] = useState<RuntimePermissionRequest[]>([]);
  const [deciding, setDeciding] = useState<RuntimePermissionDecision | null>(null);

  const refreshPending = useCallback(async () => {
    try {
      const response = await getPendingRuntimePermissions();
      setPending(response.data ?? []);
    } catch {
      // The next poll retries; avoid repetitive toasts while the sidecar restarts.
    }
  }, []);

  useEffect(() => {
    void getRuntimePermissionSettings()
      .then((response) => setMode(response.data?.settings.mode ?? "normal"))
      .catch(showApiError);
  }, []);

  useEffect(() => {
    void refreshPending();
    const timer = window.setInterval(refreshPending, 800);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  const updateMode = useCallback(async (nextMode: PermissionMode) => {
    if (loadingMode || nextMode === mode) return;
    setLoadingMode(true);
    try {
      const response = await updateRuntimePermissionSettings({ mode: nextMode });
      const savedMode = response.data?.settings.mode ?? nextMode;
      setMode(savedMode);
      if (savedMode === "full_access") setPending([]);
      Toast.success(savedMode === "full_access" ? "已启用完全访问" : "已启用普通访问");
    } catch (error) {
      showApiError(error);
    } finally {
      setLoadingMode(false);
    }
  }, [loadingMode, mode]);

  const current = pending[0] ?? null;
  const decide = useCallback(async (decision: RuntimePermissionDecision) => {
    if (!current || deciding) return;
    setDeciding(decision);
    try {
      await decideRuntimePermission(current.id ?? "", decision);
      setPending((items) => items.filter((item) => item.id !== current.id));
      if (decision === "always_allow") Toast.success("已添加始终允许规则");
    } catch (error) {
      showApiError(error);
      await refreshPending();
    } finally {
      setDeciding(null);
    }
  }, [current, deciding, refreshPending]);

  const modeIcon = mode === "full_access" ? <ShieldAlert size={15} /> : <Shield size={15} />;
  return (
    <>
      <div className={`permission-mode-control permission-mode-${mode}`}>
        {modeIcon}
        <Select
          size="small"
          value={mode}
          loading={loadingMode}
          optionList={MODE_OPTIONS}
          onChange={(value) => {
            if (value === "normal" || value === "full_access") void updateMode(value);
          }}
        />
      </div>
      <Modal
        className="runtime-permission-modal"
        title="需要你的授权"
        visible={Boolean(current)}
        width={600}
        closable={false}
        maskClosable={false}
        footer={null}
        onCancel={() => undefined}
      >
        {current ? (
          <div className="runtime-permission-body">
            <div className="runtime-permission-heading">
              <ShieldCheck size={22} />
              <div>
                <strong>{current.reason}</strong>
                <span>{current.agent_code} · {current.action_type}</span>
              </div>
              <Tag color={riskColor(current.risk_level)}>{current.risk_level}</Tag>
            </div>
            <div className="runtime-permission-target">
              <span>目标</span>
              <code>{current.target}</code>
            </div>
            {Object.keys(current.details ?? {}).length ? (
              <pre className="runtime-permission-details">{JSON.stringify(current.details ?? {}, null, 2)}</pre>
            ) : null}
            <div className="runtime-permission-actions">
              <Button
                icon={<X size={15} />}
                type="danger"
                loading={deciding === "reject"}
                disabled={Boolean(deciding)}
                onClick={() => void decide("reject")}
              >
                拒绝
              </Button>
              <Button
                theme="solid"
                type="primary"
                loading={deciding === "allow_once"}
                disabled={Boolean(deciding)}
                onClick={() => void decide("allow_once")}
              >
                本次允许
              </Button>
              <Button
                theme="solid"
                type="tertiary"
                loading={deciding === "always_allow"}
                disabled={Boolean(deciding)}
                onClick={() => void decide("always_allow")}
              >
                始终允许
              </Button>
            </div>
            {pending.length > 1 ? <span className="runtime-permission-queue">另有 {pending.length - 1} 个请求等待处理</span> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function riskColor(risk: RuntimePermissionRequest["risk_level"]): "grey" | "blue" | "amber" | "red" {
  if (risk === "L3") return "red";
  if (risk === "L2") return "amber";
  if (risk === "L1") return "blue";
  return "grey";
}

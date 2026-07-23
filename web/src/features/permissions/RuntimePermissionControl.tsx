import { Button, Modal, Select, Tag, Toast, Tooltip } from "@douyinfe/semi-ui";
import { RefreshCw, Shield, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideRuntimePermission,
  getPendingRuntimePermissions,
  getRuntimePermissionSettings,
  updateRuntimePermissionSettings,
} from "../../shared/api/runtimePermissions";
import { getApiErrorMessage, showApiError } from "../../shared/api/feedback";
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
  const [loadingMode, setLoadingMode] = useState(true);
  const [pending, setPending] = useState<RuntimePermissionRequest[]>([]);
  const [pendingError, setPendingError] = useState("");
  const [deciding, setDeciding] = useState<RuntimePermissionDecision | null>(null);
  const mountedRef = useRef(true);
  const modeUpdateRef = useRef(false);
  const decisionRef = useRef<RuntimePermissionDecision | null>(null);
  const pendingRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRequestRef.current += 1;
      modeUpdateRef.current = false;
      decisionRef.current = null;
    };
  }, []);

  const refreshPending = useCallback(async () => {
    if (decisionRef.current) return;
    const requestId = pendingRequestRef.current + 1;
    pendingRequestRef.current = requestId;
    try {
      const response = await getPendingRuntimePermissions();
      if (!mountedRef.current || pendingRequestRef.current !== requestId || decisionRef.current) return;
      setPending(response.data ?? []);
      setPendingError("");
    } catch (error) {
      if (mountedRef.current && pendingRequestRef.current === requestId) {
        setPendingError(getApiErrorMessage(error, "权限请求服务暂不可用"));
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getRuntimePermissionSettings()
      .then((response) => {
        if (active) setMode(response.data?.settings.mode ?? "normal");
      })
      .catch((error) => {
        if (active) showApiError(error);
      })
      .finally(() => {
        if (active) setLoadingMode(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "full_access") {
      pendingRequestRef.current += 1;
      setPending([]);
      setPendingError("");
      return;
    }

    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      if (document.visibilityState === "visible") await refreshPending();
      if (!stopped) timer = window.setTimeout(poll, 800);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      pendingRequestRef.current += 1;
    };
  }, [mode, refreshPending]);

  const updateMode = useCallback(async (nextMode: PermissionMode) => {
    if (modeUpdateRef.current || nextMode === mode) return;
    modeUpdateRef.current = true;
    setLoadingMode(true);
    try {
      const response = await updateRuntimePermissionSettings({ mode: nextMode });
      const savedMode = response.data?.settings.mode ?? nextMode;
      if (!mountedRef.current) return;
      setMode(savedMode);
      if (savedMode === "full_access") {
        pendingRequestRef.current += 1;
        setPending([]);
        setPendingError("");
      }
      Toast.success(savedMode === "full_access" ? "已启用完全访问" : "已启用普通访问");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      modeUpdateRef.current = false;
      if (mountedRef.current) setLoadingMode(false);
    }
  }, [mode]);

  const current = pending[0] ?? null;
  const decide = useCallback(async (decision: RuntimePermissionDecision) => {
    if (!current || decisionRef.current) return;
    const requestId = current.id ?? "";
    decisionRef.current = decision;
    setDeciding(decision);
    let refreshAfterDecision = false;
    try {
      await decideRuntimePermission(requestId, decision);
      if (!mountedRef.current) return;
      pendingRequestRef.current += 1;
      setPending((items) => items.filter((item) => item.id !== requestId));
      setPendingError("");
      refreshAfterDecision = true;
      if (decision === "always_allow") Toast.success("已添加始终允许规则");
    } catch (error) {
      if (mountedRef.current) {
        showApiError(error);
        refreshAfterDecision = true;
      }
    } finally {
      decisionRef.current = null;
      if (mountedRef.current) setDeciding(null);
    }
    if (refreshAfterDecision) void refreshPending();
  }, [current, refreshPending]);

  const modeIcon = pendingError ? (
    <Tooltip content={`${pendingError}，点击重试`}>
      <button
        type="button"
        className="permission-poll-error"
        aria-label={`${pendingError}，点击重试`}
        onClick={() => void refreshPending()}
      >
        <RefreshCw size={15} />
      </button>
    </Tooltip>
  ) : mode === "full_access" ? <ShieldAlert size={15} /> : <Shield size={15} />;
  return (
    <>
      <div className={`permission-mode-control permission-mode-${mode}`}>
        {modeIcon}
        <Select
          size="small"
          value={mode}
          loading={loadingMode}
          disabled={loadingMode}
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

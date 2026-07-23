import { Button, Modal } from "@douyinfe/semi-ui";
import { CircleAlert, RefreshCw } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { UI_TEXT } from "../lib/uiText";
import { useUnsavedChangesRegistration } from "./UnsavedChangesGuard";

type ResourceModalProps = {
  open: boolean;
  title: string;
  saving: boolean;
  dirty?: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  width?: number;
  className?: string;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
};

export type ResourceFormLoadIssue = {
  label: string;
  message: string;
};

export function ResourceModal({
  open,
  title,
  saving,
  dirty = false,
  submitLabel,
  submitDisabled = false,
  width = 520,
  className,
  onCancel,
  onSubmit,
  children,
}: ResourceModalProps) {
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) setDiscardConfirmOpen(false);
  }, [open]);

  useUnsavedChangesRegistration(open && dirty, {
    title: "放弃未保存的表单修改？",
    content: "离开当前页面后，本次表单修改将无法恢复。",
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || submitDisabled) return;
    await onSubmit();
  };

  const requestCancel = () => {
    if (saving || discardConfirmOpen) return;
    if (!dirty) {
      onCancel();
      return;
    }
    setDiscardConfirmOpen(true);
  };

  return (
    <>
      <Modal
        title={title}
        visible={open}
        onCancel={requestCancel}
        footer={null}
        width={width}
        maskClosable={!saving}
        closable={!saving}
        className={className}
      >
        <form className="resource-form" aria-busy={saving} inert={saving ? true : undefined} onSubmit={handleSubmit}>
          {children}
          <div className="modal-actions">
            <Button type="tertiary" onClick={requestCancel} disabled={saving}>{UI_TEXT.cancel}</Button>
            <Button htmlType="submit" theme="solid" type="primary" loading={saving} disabled={saving || submitDisabled}>{submitLabel}</Button>
          </div>
        </form>
      </Modal>
      <Modal
        visible={discardConfirmOpen}
        title="放弃未保存的修改？"
        okText="放弃修改"
        cancelText="继续编辑"
        okType="danger"
        maskClosable={false}
        onOk={() => {
          setDiscardConfirmOpen(false);
          onCancel();
        }}
        onCancel={() => setDiscardConfirmOpen(false)}
      >
        <p className="unsaved-changes-dialog-content">
          关闭后，本次表单修改将无法恢复。
        </p>
      </Modal>
    </>
  );
}

export function ResourceFormLoadError({
  issues,
  loading = false,
  onRetry,
}: {
  issues: ResourceFormLoadIssue[];
  loading?: boolean;
  onRetry: () => void;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="resource-form-load-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span>
        <strong>部分表单选项加载失败</strong>
        <span>{issues.map((issue) => `${issue.label}：${issue.message}`).join("；")}</span>
      </span>
      <Button
        htmlType="button"
        icon={<RefreshCw size={14} />}
        loading={loading}
        size="small"
        theme="borderless"
        type="tertiary"
        onClick={onRetry}
      >
        重试
      </Button>
    </div>
  );
}

import { Modal, Spin } from "@douyinfe/semi-ui";
import { lazy, Suspense } from "react";
import type { WorkProjectInfoModalProps } from "./WorkProjectInfoModal";

const WorkProjectInfoModal = lazy(() => import("./WorkProjectInfoModal").then((module) => ({
  default: module.WorkProjectInfoModal,
})));

export function DeferredWorkProjectInfoModal(props: WorkProjectInfoModalProps) {
  if (!props.open) return null;

  return (
    <Suspense
      fallback={(
        <Modal
          visible
          title="工作项目"
          width="min(1440px, calc(100vw - 24px))"
          footer={null}
          onCancel={props.onClose}
        >
          <div className="project-info-lazy-fallback" role="status" aria-live="polite">
            <Spin spinning />
            <span>正在加载项目详情</span>
          </div>
        </Modal>
      )}
    >
      <WorkProjectInfoModal {...props} />
    </Suspense>
  );
}

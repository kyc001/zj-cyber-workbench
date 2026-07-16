import { Button, Popconfirm, Tag } from "@douyinfe/semi-ui";
import { Boxes, Network, Route, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createSandboxImage, deleteSandboxImage, querySandboxImages } from "../../shared/api/sandboxImages";
import type { CreateSandboxImageRequest, SandboxImage } from "../../shared/api/types";
import { ResourcePageShell } from "../../shared/components/ResourcePageShell";
import { ResourceTable, type ResourceColumn } from "../../shared/components/ResourceTable";
import { ResourceIdentity, ResourceText, RowActions } from "../../shared/components/ResourceCells";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";
import { usePagedResourceList } from "../../shared/hooks/usePagedResourceList";
import { useResourceAction } from "../../shared/hooks/useResourceAction";
import { useResourceSubmit } from "../../shared/hooks/useResourceSubmit";
import { formatDateTime } from "../../shared/lib/date";
import { UI_TEXT } from "../../shared/lib/uiText";
import { SandboxImageFormModal } from "./SandboxImageFormModal";

export function SandboxImagesPage() {
  const {
    items: images, page, keyword, loading, loadItems: loadImages, total, rangeStart, rangeEnd,
    setKeyword, search, previous, next, canGoBack, canGoNext,
  } = usePagedResourceList<SandboxImage>({ query: querySandboxImages });
  const [modalOpen, setModalOpen] = useState(false);

  const { run: deleteImage, busyId: deletingId } = useResourceAction<SandboxImage>(
    (image) => deleteSandboxImage(image.id), loadImages,
  );

  useAdminResourceHeader({
    createLabel: "创建工具基线",
    refreshLabel: "刷新工具基线",
    loading,
    onCreate: () => setModalOpen(true),
    onRefresh: loadImages,
  });

  const { saving, submit } = useResourceSubmit({
    onSuccess: async () => {
      setModalOpen(false);
      await loadImages();
    },
  });

  const summary = useMemo(
    () => images.reduce(
      (acc, image) => ({
        tor: acc.tor + (image.supports_tor ? 1 : 0),
      }),
      { tor: 0 },
    ),
    [images],
  );

  const handleCreate = (payload: CreateSandboxImageRequest) => submit(() => createSandboxImage(payload));

  const columns: ResourceColumn<SandboxImage>[] = [
    {
      key: "image", header: "工具基线", width: "minmax(280px, 360px)",
      render: (image) => (
        <ResourceIdentity
          icon={<Boxes size={18} />}
          title={image.image_name}
          detail={<><Network size={13} />兼容控制端口 {image.control_proxy_port}</>}
        />
      ),
    },
    { key: "port", header: "控制端口", width: "130px", render: (image) => image.control_proxy_port },
    {
      key: "capabilities", header: "能力", width: "180px",
      render: (image) => (
        <div className="port-mapping-list">
          {image.supports_tor ? <Tag color="violet" prefixIcon={<Route size={12} />}>Tor</Tag> : null}
          {!image.supports_tor ? <ResourceText>基础工具</ResourceText> : null}
        </div>
      ),
    },
    { key: "created", header: "创建时间", width: "minmax(150px, 1fr)", render: (i) => formatDateTime(i.created_at) },
    { key: "updated", header: "更新时间", width: "minmax(150px, 1fr)", render: (i) => formatDateTime(i.updated_at) },
    {
      key: "actions", header: "操作", width: "104px",
      render: (image) => (
        <RowActions>
          <Popconfirm title="删除工具基线" content={`确定删除 ${image.image_name}？`} okType="danger" cancelText={UI_TEXT.cancel} onConfirm={() => void deleteImage(image)}>
            <Button icon={<Trash2 size={15} />} theme="borderless" type="danger"
              loading={deletingId === image.id} aria-label={`Delete ${image.image_name}`}
            />
          </Popconfirm>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <ResourcePageShell
        searchPlaceholder="搜索工具基线名称"
        keyword={keyword}
        loading={loading}
        metrics={[
          { label: "总数", value: total },
          { label: "Tor", value: summary.tor },
        ]}
        empty={images.length === 0}
        emptyIcon={<Boxes size={42} />}
        emptyTitle="未找到工具基线"
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
        <ResourceTable<SandboxImage>
          ariaLabel="工具基线"
          columns={columns}
          rows={images}
          rowKey={(image) => image.id}
        />
      </ResourcePageShell>

      <SandboxImageFormModal
        open={modalOpen}
        saving={saving}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}

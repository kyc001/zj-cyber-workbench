import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react";
import type { AgentImageInputPart } from "../../shared/api/types";

export type ImagePreviewState = { src: string; alt: string } | null;

export function imageDataUrl(image: AgentImageInputPart): string {
  return `data:${image.media_type};base64,${image.data}`;
}

const MIN_PREVIEW_SCALE = 0.3;
const MAX_PREVIEW_SCALE = 4;
const PREVIEW_SCALE_STEP = 0.25;

export function ImagePreview({
  preview,
  onClose,
}: {
  preview: ImagePreviewState;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const setClampedScale = useCallback((next: number | ((current: number) => number)) => {
    setScale((current) => {
      const value = typeof next === "function" ? next(current) : next;
      return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, Number(value.toFixed(2))));
    });
  }, []);

  const zoomIn = useCallback(() => {
    setClampedScale((value) => value + PREVIEW_SCALE_STEP);
  }, [setClampedScale]);

  const zoomOut = useCallback(() => {
    setClampedScale((value) => value - PREVIEW_SCALE_STEP);
  }, [setClampedScale]);

  const resetZoom = useCallback(() => {
    setClampedScale(1);
  }, [setClampedScale]);

  useEffect(() => {
    if (!preview) return;
    setScale(1);
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (event.key === "Tab") {
        const controls = [...(overlayRef.current?.querySelectorAll<HTMLElement>("[data-preview-control]") ?? [])]
          .filter((element) => !element.hasAttribute("disabled"));
        if (!controls.length) return;
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % controls.length;
        event.preventDefault();
        controls[nextIndex]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [preview, resetZoom, zoomIn, zoomOut]);

  if (!preview) return null;

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setClampedScale((value) => value + delta);
  };

  return (
    <div
      ref={overlayRef}
      className="image-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      aria-describedby="image-preview-scale"
      onClick={onClose}
      onWheel={handleWheel}
    >
      <button
        ref={closeButtonRef}
        type="button"
        className="image-preview-close"
        data-preview-control
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="关闭图片预览"
        title="关闭"
      >
        <X size={20} />
      </button>
      <div className="image-preview-stage">
        <img
          className="image-preview-img"
          src={preview.src}
          alt={preview.alt}
          draggable={false}
          style={{ transform: `scale(${scale})` }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setClampedScale((value) => value > 1 ? 1 : 2);
          }}
        />
      </div>
      <div
        className="image-preview-toolbar"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="image-preview-control"
          data-preview-control
          disabled={scale <= MIN_PREVIEW_SCALE}
          aria-label="缩小图片"
          title="缩小（-）"
          onClick={zoomOut}
        >
          <Minus size={17} />
        </button>
        <button
          type="button"
          className="image-preview-scale"
          data-preview-control
          disabled={scale === 1}
          aria-label={`当前缩放 ${Math.round(scale * 100)}%，点击恢复原始比例`}
          title="恢复 100%（0）"
          onClick={resetZoom}
        >
          <RotateCcw size={14} />
          <output id="image-preview-scale" aria-live="polite" aria-atomic="true">
            {Math.round(scale * 100)}%
          </output>
        </button>
        <button
          type="button"
          className="image-preview-control"
          data-preview-control
          disabled={scale >= MAX_PREVIEW_SCALE}
          aria-label="放大图片"
          title="放大（+）"
          onClick={zoomIn}
        >
          <Plus size={17} />
        </button>
      </div>
    </div>
  );
}

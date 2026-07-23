import { Button, Spin } from "@douyinfe/semi-ui";
import { ArrowDown, CircleAlert, RefreshCw } from "lucide-react";
import { ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../shared/lib/className";
import { useAutoFollowScroll } from "./useAutoFollowScroll";

type MessageScrollPanelProps = {
  ariaLabel: string;
  children: (tailRef: RefObject<HTMLDivElement | null>) => ReactNode;
  className?: string;
  contentClassName?: string;
  enabled?: boolean;
  error?: string;
  loading?: boolean;
  loadingPrevious?: boolean;
  onLoadPrevious?: () => void;
  onRetry?: () => void;
  preserveScrollKey?: string | number | null;
  resetKey?: string | number | null;
  scrollButtonClassName?: string;
  watch?: readonly unknown[];
};

const SCROLLBAR_VISIBLE_MS = 900;

export function MessageScrollPanel({
  ariaLabel,
  children,
  className = "",
  contentClassName = "",
  enabled = true,
  error = "",
  loading = false,
  loadingPrevious = false,
  onLoadPrevious,
  onRetry,
  preserveScrollKey,
  resetKey,
  scrollButtonClassName = "",
  watch = [],
}: MessageScrollPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousHeightRef = useRef(0);
  const loadPreviousThrottleRef = useRef(false);
  const scrollbarTimerRef = useRef<number | null>(null);
  const scrollbarVisibleRef = useRef(false);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);

  const showScrollbar = useCallback(() => {
    if (!enabled) return;
    if (!scrollbarVisibleRef.current) {
      scrollbarVisibleRef.current = true;
      setScrollbarVisible(true);
    }
    if (scrollbarTimerRef.current !== null) window.clearTimeout(scrollbarTimerRef.current);
    scrollbarTimerRef.current = window.setTimeout(() => {
      scrollbarTimerRef.current = null;
      scrollbarVisibleRef.current = false;
      setScrollbarVisible(false);
    }, SCROLLBAR_VISIBLE_MS);
  }, [enabled]);

  useEffect(() => {
    if (!loadingPrevious) loadPreviousThrottleRef.current = false;
  }, [loadingPrevious]);

  useEffect(() => {
    return () => {
      if (scrollbarTimerRef.current !== null) window.clearTimeout(scrollbarTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (enabled) return;
    if (scrollbarTimerRef.current !== null) {
      window.clearTimeout(scrollbarTimerRef.current);
      scrollbarTimerRef.current = null;
    }
    scrollbarVisibleRef.current = false;
    setScrollbarVisible(false);
  }, [enabled]);

  const onScrollToTop = useCallback(() => {
    const container = containerRef.current;
    if (!container || !onLoadPrevious || loading || loadingPrevious || loadPreviousThrottleRef.current) return;
    loadPreviousThrottleRef.current = true;
    previousHeightRef.current = container.scrollHeight;
    onLoadPrevious();
  }, [loading, loadingPrevious, onLoadPrevious]);

  const {
    following,
    tailRef,
    scrollHandlers,
    scrollToLatest,
  } = useAutoFollowScroll({
    enabled,
    containerRef,
    onUserScrollIntent: showScrollbar,
    resetKey,
    watch,
    suspendAutoFollow: Boolean(previousHeightRef.current) || loadingPrevious,
    onScrollToTop,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousHeight = previousHeightRef.current;
    if (!container || !previousHeight) return;
    const nextScrollTop = container.scrollTop + container.scrollHeight - previousHeight;
    container.style.overflowAnchor = "none";
    container.scrollTop = nextScrollTop;
    previousHeightRef.current = 0;
    window.requestAnimationFrame(() => {
      if (containerRef.current === container) container.style.overflowAnchor = "";
    });
  }, [preserveScrollKey]);

  return (
    <div className={cx("message-scroll-shell", className)}>
      <div
        ref={containerRef}
        className={cx("message-scroll-viewport", scrollbarVisible && "message-scroll-viewport-scrolling")}
        aria-label={ariaLabel}
        aria-busy={loading}
        tabIndex={0}
        {...scrollHandlers}
      >
        <div className={cx("message-scroll-content", contentClassName)}>
          {children(tailRef)}
        </div>
      </div>
      {loading ? (
        <div className="message-scroll-loading" aria-hidden="true">
          <Spin spinning />
        </div>
      ) : null}
      {error && !loading ? (
        <div className="message-scroll-error" role="alert">
          <CircleAlert size={24} />
          <strong>无法加载会话历史</strong>
          <span>{error}</span>
          {onRetry ? (
            <Button
              icon={<RefreshCw size={14} />}
              theme="solid"
              type="primary"
              onClick={onRetry}
            >
              重新加载
            </Button>
          ) : null}
        </div>
      ) : null}
      {enabled && !following ? (
        <Button
          className={cx("message-scroll-tail-floating", scrollButtonClassName)}
          icon={<ArrowDown size={16} />}
          theme="solid"
          type="tertiary"
          onClick={scrollToLatest}
          aria-label="滚动到最新消息"
        />
      ) : null}
    </div>
  );
}

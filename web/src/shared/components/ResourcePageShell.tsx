import { Button, Empty, Input, Spin } from "@douyinfe/semi-ui";
import { CircleAlert, RefreshCw, Search, X } from "lucide-react";
import { FormEvent, ReactNode } from "react";
import { cx } from "../lib/className";
import { UI_TEXT } from "../lib/uiText";

export type ResourceMetric = {
  label: string;
  value: ReactNode;
};

type ResourcePageShellProps = {
  searchPlaceholder: string;
  keyword: string;
  activeKeyword: string;
  loading: boolean;
  error?: string;
  metrics: ResourceMetric[];
  empty: boolean;
  emptyIcon: ReactNode;
  emptyTitle: string;
  page: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  canGoBack: boolean;
  canGoNext: boolean;
  children: ReactNode;
  onKeywordChange: (keyword: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRetry?: () => void;
};

export function ResourcePageShell({
  searchPlaceholder,
  keyword,
  activeKeyword,
  loading,
  error = "",
  metrics,
  empty,
  emptyIcon,
  emptyTitle,
  page,
  rangeStart,
  rangeEnd,
  total,
  canGoBack,
  canGoNext,
  children,
  onKeywordChange,
  onSearch,
  onClearSearch,
  onPrevious,
  onNext,
  onRetry,
}: ResourcePageShellProps) {
  return (
    <section className="resource-page">
      <MetricStrip metrics={metrics} />
      <ResourcePanel
        toolbar={(
          <ResourceSearchForm
            value={keyword}
            activeValue={activeKeyword}
            placeholder={searchPlaceholder}
            loading={loading}
            resultTotal={loading ? undefined : total}
            onChange={onKeywordChange}
            onSearch={onSearch}
            onClear={onClearSearch}
          />
        )}
        loading={loading}
        error={error}
        errorTitle="无法加载列表"
        onRetry={onRetry}
        empty={empty}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        emptyDescription={activeKeyword ? "请尝试更换关键词，或清除当前筛选。" : ""}
        footer={(
          <ResourcePager
            page={page}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
            loading={loading}
            canGoBack={canGoBack}
            canGoNext={canGoNext}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        )}
      >
        {children}
      </ResourcePanel>
    </section>
  );
}

export function ResourcePanel({
  className,
  toolbar,
  loading = false,
  error = "",
  errorTitle = "无法加载数据",
  empty,
  emptyIcon,
  emptyTitle,
  emptyDescription = "",
  footer,
  children,
  onRetry,
}: {
  className?: string;
  toolbar?: ReactNode;
  loading?: boolean;
  error?: string;
  errorTitle?: string;
  empty: boolean;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onRetry?: () => void;
}) {
  const blockingError = Boolean(error && empty && !loading);
  return (
    <div className={cx("table-panel", className)} aria-busy={loading}>
      {toolbar ? <div className="table-toolbar">{toolbar}</div> : null}
      {error && !blockingError && !loading ? (
        <ResourceError
          compact
          message={error}
          title={errorTitle}
          onRetry={onRetry}
        />
      ) : null}
      <Spin spinning={loading} wrapperClassName="resource-table-spin">
        {blockingError ? (
          <ResourceError message={error} title={errorTitle} onRetry={onRetry} />
        ) : empty ? (
          <Empty
            className="empty-state"
            image={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : children}
      </Spin>
      {blockingError ? null : footer}
    </div>
  );
}

export function ResourceSearchForm({
  value,
  activeValue = "",
  placeholder,
  loading = false,
  resultTotal,
  onChange,
  onSearch,
  onClear,
}: {
  value: string;
  activeValue?: string;
  placeholder: string;
  loading?: boolean;
  resultTotal?: number;
  onChange: (value: string) => void;
  onSearch: () => void;
  onClear?: () => void;
}) {
  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch();
  };
  return (
    <form aria-label="列表搜索" onSubmit={handleSearch}>
      <Input
        prefix={<Search size={16} />}
        value={value}
        onChange={onChange}
        onClear={onClear}
        placeholder={placeholder}
        aria-label={placeholder}
        showClear
      />
      <Button
        htmlType="submit"
        theme="solid"
        type="primary"
        icon={<Search size={16} />}
        loading={loading}
        disabled={loading}
      >
        {UI_TEXT.search}
      </Button>
      {activeValue ? (
        <div className="resource-search-status" role="status" aria-live="polite" aria-atomic="true">
          <span>
            当前筛选：<strong>“{activeValue}”</strong>
            {typeof resultTotal === "number" ? `，共 ${resultTotal} 条` : ""}
          </span>
          {onClear ? (
            <Button
              className="resource-search-clear"
              icon={<X size={14} />}
              theme="borderless"
              type="tertiary"
              size="small"
              onClick={onClear}
            >
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function ResourceError({
  compact = false,
  message,
  title,
  onRetry,
}: {
  compact?: boolean;
  message: string;
  title: string;
  onRetry?: () => void;
}) {
  return (
    <div className={cx("resource-load-error", compact && "resource-load-error-compact")} role="alert">
      <CircleAlert size={compact ? 16 : 28} aria-hidden="true" />
      <span className="resource-load-error-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
      {onRetry ? (
        <Button
          icon={<RefreshCw size={14} />}
          theme={compact ? "borderless" : "solid"}
          type={compact ? "tertiary" : "primary"}
          size="small"
          onClick={onRetry}
        >
          重新加载
        </Button>
      ) : null}
    </div>
  );
}

export function ResourcePager({
  page, rangeStart, rangeEnd, total, loading, canGoBack, canGoNext, onPrevious, onNext,
}: {
  page: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  loading: boolean;
  canGoBack: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="pager-row" aria-label="列表分页">
      <span role="status" aria-live="polite" aria-atomic="true">
        第 {page} 页 · {rangeStart}-{rangeEnd} / 共 {total} 条
      </span>
      <div>
        <Button
          type="tertiary"
          disabled={!canGoBack || loading}
          aria-label={`前往第 ${Math.max(1, page - 1)} 页`}
          onClick={onPrevious}
        >
          {UI_TEXT.previous}
        </Button>
        <Button
          type="tertiary"
          disabled={!canGoNext || loading}
          aria-label={`前往第 ${page + 1} 页`}
          onClick={onNext}
        >
          {UI_TEXT.next}
        </Button>
      </div>
    </nav>
  );
}

export function MetricStrip({ metrics }: { metrics: ResourceMetric[] }) {
  return (
    <div className="metric-strip" role="list" aria-label="数据概览">
      {metrics.map((metric) => (
        <div className="metric-card" role="listitem" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

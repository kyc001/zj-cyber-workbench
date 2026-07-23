import {
  CSSProperties,
  ReactNode,
  UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../lib/className";

export type ResourceColumn<T> = {
  key: string;
  header: ReactNode;
  width: string;
  render: (row: T) => ReactNode;
};

type ResourceTableProps<T> = {
  ariaLabel: string;
  className?: string;
  columns: ResourceColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
};

export function ResourceTable<T>({ ariaLabel, className, columns, rows, rowKey }: ResourceTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState({
    overflowing: false,
    atStart: true,
    atEnd: true,
  });
  const gridTemplate: CSSProperties = {
    gridTemplateColumns: columns.map((col) => col.width).join(" "),
  };

  const syncScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const overflowing = element.scrollWidth - element.clientWidth > 1;
    const atStart = !overflowing || element.scrollLeft <= 1;
    const atEnd = !overflowing || element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    setScrollState((current) => (
      current.overflowing === overflowing
      && current.atStart === atStart
      && current.atEnd === atEnd
        ? current
        : { overflowing, atStart, atEnd }
    ));
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(syncScrollState);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncScrollState);
    observer?.observe(element);
    const table = element.firstElementChild;
    if (table) observer?.observe(table);
    window.addEventListener("resize", syncScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", syncScrollState);
    };
  }, [syncScrollState]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    syncScrollState();
  }, [rows, syncScrollState]);

  const handleScroll = (_event: UIEvent<HTMLDivElement>) => {
    syncScrollState();
  };

  return (
    <div
      ref={scrollRef}
      className={cx(
        "resource-table-scroll",
        scrollState.overflowing && "resource-table-scroll-overflowing",
        scrollState.atStart && "resource-table-scroll-at-start",
        scrollState.atEnd && "resource-table-scroll-at-end",
      )}
      role={scrollState.overflowing ? "region" : undefined}
      aria-label={scrollState.overflowing ? `${ariaLabel}横向滚动区域` : undefined}
      tabIndex={scrollState.overflowing ? 0 : undefined}
      onScroll={handleScroll}
    >
      <div
        className={cx("resource-table", className)}
        role="table"
        aria-label={ariaLabel}
        aria-colcount={columns.length}
        aria-rowcount={rows.length + 1}
      >
        <div className="resource-table-row resource-table-head" role="row" aria-rowindex={1} style={gridTemplate}>
          {columns.map((col, columnIndex) => (
            <div
              key={col.key}
              role="columnheader"
              aria-colindex={columnIndex + 1}
              className={`resource-cell-${col.key}`}
            >
              {col.header}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div
            key={rowKey(row)}
            className="resource-table-row"
            role="row"
            aria-rowindex={rowIndex + 2}
            style={gridTemplate}
          >
            {columns.map((col, columnIndex) => (
              <div
                key={col.key}
                role="cell"
                aria-colindex={columnIndex + 1}
                className={`resource-cell-${col.key}`}
              >
                {col.render(row)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

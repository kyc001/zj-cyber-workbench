import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "../api/feedback";

type QueryResponse<Item> = {
  data?: {
    items: Item[];
  } | null;
};

type QueryOptions<Item> = {
  enabled?: boolean;
  query: (params: { page: number; size: number; keyword: string }) => Promise<QueryResponse<Item>>;
};

export function useOptionList<Item>({ enabled = true, query }: QueryOptions<Item>) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // React Strict Mode intentionally mounts, cleans up, and mounts effects
    // again in development. Restore the flag on every setup so the second
    // pass can commit its request result.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const response = await query({ page: 1, size: 100, keyword: "" });
      if (mountedRef.current && requestIdRef.current === requestId) {
        setItems(response.data?.items ?? []);
        setError("");
      }
    } catch (error) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(getApiErrorMessage(error, "加载选项失败"));
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (enabled) {
      void load();
      return;
    }
    requestIdRef.current += 1;
    setLoading(false);
  }, [enabled, load]);

  return { items, loading, error, load };
}

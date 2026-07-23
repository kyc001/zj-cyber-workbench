import { useCallback, useEffect, useRef, useState } from "react";
import { showApiError, showApiSuccess } from "../api/feedback";
import type { CommonResponsePayload } from "../api/types";

export function useResourceAction<Item extends { id: string | number }>(
  action: (item: Item) => Promise<CommonResponsePayload>,
  onAfter?: () => void | Promise<void>,
) {
  const [busyId, setBusyId] = useState<Item["id"] | null>(null);
  const [busyItem, setBusyItem] = useState<Item | null>(null);
  const mountedRef = useRef(true);
  const busyIdRef = useRef<Item["id"] | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (item: Item) => {
      if (busyIdRef.current !== null) return;
      busyIdRef.current = item.id;
      setBusyId(item.id);
      setBusyItem(item);
      try {
        const response = await action(item);
        if (!mountedRef.current) return;
        showApiSuccess(response);
        await onAfter?.();
      } catch (error) {
        if (mountedRef.current) showApiError(error);
      } finally {
        busyIdRef.current = null;
        if (mountedRef.current) {
          setBusyId(null);
          setBusyItem(null);
        }
      }
    },
    [action, onAfter],
  );

  return { run, busyId, busyItem };
}

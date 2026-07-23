import { useCallback, useEffect, useRef, useState } from "react";
import { showApiError, showApiSuccess } from "../api/feedback";
import type { CommonResponsePayload } from "../api/types";


type ResourceSubmitOptions = {
  onSuccess?: () => void | Promise<void>;
};

export function useResourceSubmit({ onSuccess }: ResourceSubmitOptions = {}) {
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    // React Strict Mode runs an extra setup/cleanup cycle in development.
    // Restore the flag on every setup so completed submissions can still
    // clear their busy state and refresh the page during the second pass.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      savingRef.current = false;
    };
  }, []);

  const submit = useCallback(
    async (action: () => Promise<CommonResponsePayload>) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        const response = await action();
        if (!mountedRef.current) return;
        showApiSuccess(response);
        await onSuccess?.();
      } catch (error) {
        if (mountedRef.current) showApiError(error);
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    },
    [onSuccess],
  );

  return { saving, submit };
}

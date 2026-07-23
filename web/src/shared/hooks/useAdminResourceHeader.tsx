import { Button } from "@douyinfe/semi-ui";
import { Plus, RefreshCw } from "lucide-react";
import { ReactNode, useCallback, useEffect, useRef } from "react";
import { useAdminHeaderActions } from "../../app/layouts/AdminLayout";


type AdminResourceHeaderOptions = {
  createLabel?: string;
  createDisabled?: boolean;
  refreshLabel: string;
  loading: boolean;
  refreshDisabled?: boolean;
  onCreate?: () => void;
  onRefresh: () => void | Promise<void>;
  createIcon?: ReactNode;
  extraActions?: ReactNode;
  appendExtraActions?: boolean;
};

export function useAdminResourceHeader({
  createLabel,
  createDisabled = false,
  refreshLabel,
  loading,
  refreshDisabled = false,
  onCreate,
  onRefresh,
  createIcon,
  extraActions,
  appendExtraActions = false,
}: AdminResourceHeaderOptions) {
  const setHeaderActions = useAdminHeaderActions();
  const onCreateRef = useRef(onCreate);
  const onRefreshRef = useRef(onRefresh);
  onCreateRef.current = onCreate;
  onRefreshRef.current = onRefresh;

  const create = useCallback(() => {
    onCreateRef.current?.();
  }, []);
  const refresh = useCallback(() => {
    void onRefreshRef.current();
  }, []);
  const hasCreate = Boolean(onCreate);

  useEffect(() => {
    const refreshButton = (
      <Button
        icon={<RefreshCw size={16} />}
        type="tertiary"
        onClick={refresh}
        loading={loading}
        disabled={refreshDisabled}
        aria-label={refreshLabel}
        title={refreshLabel}
      />
    );
    const createButton = createLabel && hasCreate ? (
      <Button
        icon={createIcon ?? <Plus size={16} />}
        theme="solid"
        type="primary"
        disabled={createDisabled}
        onClick={create}
      >
        {createLabel}
      </Button>
    ) : null;

    setHeaderActions(
      <>
        {appendExtraActions ? null : extraActions}
        {refreshButton}
        {createButton}
        {appendExtraActions ? extraActions : null}
      </>,
    );
    return () => setHeaderActions(null);
  }, [
    appendExtraActions,
    createIcon,
    createLabel,
    createDisabled,
    extraActions,
    hasCreate,
    loading,
    create,
    refresh,
    refreshDisabled,
    refreshLabel,
    setHeaderActions,
  ]);
}

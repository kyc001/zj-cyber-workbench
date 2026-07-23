import { Modal } from "@douyinfe/semi-ui";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBlocker } from "react-router-dom";

type UnsavedChangesCopy = {
  title: string;
  content: string;
};

type UnsavedChangesGuardProps = Partial<UnsavedChangesCopy> & {
  dirty: boolean;
};

type UnsavedChangesRegistration = (
  key: symbol,
  value: UnsavedChangesCopy | null,
) => void;

const UnsavedChangesContext = createContext<UnsavedChangesRegistration | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [registrations, setRegistrations] = useState<Map<symbol, UnsavedChangesCopy>>(() => new Map());
  const register = useCallback<UnsavedChangesRegistration>((key, value) => {
    setRegistrations((current) => {
      const existing = current.get(key);
      if (!value) {
        if (!existing) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      }
      if (existing?.title === value.title && existing.content === value.content) return current;
      return new Map(current).set(key, value);
    });
  }, []);
  const activeCopy = useMemo(() => {
    const copies = Array.from(registrations.values());
    return copies[copies.length - 1];
  }, [registrations]);

  return (
    <UnsavedChangesContext.Provider value={register}>
      {children}
      <UnsavedChangesGuard
        dirty={registrations.size > 0}
        title={activeCopy?.title}
        content={activeCopy?.content}
      />
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesRegistration(
  dirty: boolean,
  {
    title = "放弃未保存的修改？",
    content = "离开当前页面后，本次修改将无法恢复。",
  }: Partial<UnsavedChangesCopy> = {},
) {
  const register = useContext(UnsavedChangesContext);
  const keyRef = useRef(Symbol("unsaved-changes"));

  useEffect(() => {
    if (!register) return;
    register(keyRef.current, dirty ? { title, content } : null);
    return () => register(keyRef.current, null);
  }, [content, dirty, register, title]);
}

function UnsavedChangesGuard({
  dirty,
  title = "放弃未保存的修改？",
  content = "离开当前页面后，本次修改将无法恢复。",
}: UnsavedChangesGuardProps) {
  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }: {
      currentLocation: { pathname: string; search: string; hash: string };
      nextLocation: { pathname: string; search: string; hash: string };
    }) => dirty && (
      currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash
    ),
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  return (
    <Modal
      visible={blocker.state === "blocked"}
      title={title}
      okText="放弃并离开"
      cancelText="继续编辑"
      okType="danger"
      maskClosable={false}
      onOk={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
      onCancel={() => {
        if (blocker.state === "blocked") blocker.reset();
      }}
    >
      <p className="unsaved-changes-dialog-content">{content}</p>
    </Modal>
  );
}

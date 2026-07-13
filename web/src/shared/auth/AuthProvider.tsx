import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { bootstrapDesktopSession } from "../api/desktop";
import { isSystemUserRole } from "../api/contract";
import type { SystemUserRole } from "../api/types";
import { isDesktopRuntime } from "../lib/desktopRuntime";
import { clearStoredAccessToken, getStoredAccessToken, storeAccessToken } from "./session";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  isDesktop: boolean;
  isAuthenticated: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
};

type AuthUser = {
  id: number;
  role: SystemUserRole;
  email: string;
  username: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isDesktop = isDesktopRuntime();
  const [token, setToken] = useState<string | null>(() => getStoredAccessToken());
  const [ready, setReady] = useState(!isDesktop);

  const startDesktopSession = useCallback(async () => {
    const nextToken = await bootstrapDesktopSession();
    storeAccessToken(nextToken);
    setToken(nextToken);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    setReady(false);
    void startDesktopSession()
      .catch((error) => console.error(error))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [isDesktop, startDesktopSession]);

  const signIn = useCallback((nextToken: string) => {
    storeAccessToken(nextToken);
    setToken(nextToken);
  }, []);

  const signOut = useCallback(() => {
    clearStoredAccessToken();
    setToken(null);
    if (isDesktop) {
      setReady(false);
      void startDesktopSession()
        .catch((error) => console.error(error))
        .finally(() => setReady(true));
    }
  }, [isDesktop, startDesktopSession]);

  useEffect(() => {
    const handleAuthExpired = () => signOut();
    window.addEventListener("z3r0:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("z3r0:auth-expired", handleAuthExpired);
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user: decodeUser(token),
      ready,
      isDesktop,
      isAuthenticated: Boolean(token),
      signIn,
      signOut,
    }),
    [isDesktop, ready, signIn, signOut, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

function decodeUser(token: string | null): AuthUser | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    if (
      typeof parsed.id === "number"
      && isSystemUserRole(parsed.role)
      && typeof parsed.email === "string"
      && typeof parsed.username === "string"
    ) {
      return {
        id: parsed.id,
        role: parsed.role,
        email: parsed.email,
        username: parsed.username,
      };
    }
  } catch {
    return null;
  }
  return null;
}

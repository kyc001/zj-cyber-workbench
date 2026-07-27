import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  getCurrentUser,
  login as loginRequest,
  register as registerRequest,
  type AuthUser,
} from "../api/auth";
import { storeAccessToken } from "./session";

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (payload: { username_or_email: string; password: string }) => Promise<void>;
  register: (payload: {
    username: string;
    email: string;
    display_name: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    getCurrentUser()
      .then((response) => {
        if (!canceled) setUser(response.data ?? null);
      })
      .catch(() => {
        storeAccessToken("");
        if (!canceled) setUser(null);
      })
      .finally(() => {
        if (!canceled) setReady(true);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const login = useCallback<AuthContextValue["login"]>(async (payload) => {
    const response = await loginRequest(payload);
    const session = response.data;
    if (!session?.access_token || !session.user) throw new Error("登录响应缺少会话数据");
    storeAccessToken(session.access_token);
    setUser(session.user);
  }, []);

  const register = useCallback<AuthContextValue["register"]>(async (payload) => {
    const response = await registerRequest(payload);
    const session = response.data;
    if (!session?.access_token || !session.user) throw new Error("注册响应缺少会话数据");
    storeAccessToken(session.access_token);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    storeAccessToken("");
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    ready,
    isAuthenticated: Boolean(user),
    login,
    register,
    logout,
  }), [login, logout, ready, register, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

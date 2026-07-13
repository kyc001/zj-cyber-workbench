import { createContext, useContext, useMemo } from "react";
import type { SystemUserRole } from "../api/types";

type AuthContextValue = {
  user: AuthUser;
  ready: true;
  isAuthenticated: true;
};

type AuthUser = {
  id: number;
  role: SystemUserRole;
  email: string;
  username: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<AuthContextValue>(() => ({
    user: {
      id: 0,
      role: "admin",
      email: "desktop@localhost",
      username: "本机用户",
    },
    ready: true,
    isAuthenticated: true,
  }), []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

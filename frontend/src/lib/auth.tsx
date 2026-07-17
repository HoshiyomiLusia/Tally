import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, TOKEN_KEY } from "./api";

interface AuthUser {
  id: number;
  username: string;
  is_active: boolean;
  primary_currency_code: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await api.get("/users/me");
      setUser(r.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (username: string, password: string) => {
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("password", password);
    const r = await api.post("/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    localStorage.setItem(TOKEN_KEY, r.data.access_token);
    qc.clear();  // 清掉上一会话的所有缓存, 防同浏览器切账号时看到上一用户的余额/交易/持仓(审计 #91)
    await fetchMe();
  }, [fetchMe, qc]);

  const register = useCallback(async (username: string, password: string) => {
    await api.post("/auth/register", { username, password });
    await login(username, password);
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    qc.clear();  // 登出即清缓存, 防下一用户在 staleTime 窗口内看到上一用户数据(审计 #91)
  }, [qc]);

  const value = useMemo(() => ({ user, loading, login, register, logout, refresh: fetchMe }), [user, loading, login, register, logout, fetchMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

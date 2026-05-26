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
    await fetchMe();
  }, [fetchMe]);

  const register = useCallback(async (username: string, password: string) => {
    await api.post("/auth/register", { username, password });
    await login(username, password);
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, refresh: fetchMe }), [user, loading, login, register, logout, fetchMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

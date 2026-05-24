import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../lib/auth";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-ink-400">加载中…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

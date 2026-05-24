import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setBusy(true);
    try {
      await register(email, password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(extractError(err) ?? "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">注册</div>
          <div className="mt-1 text-sm text-ink-500">创建一个新账号</div>
        </div>
        <label className="block">
          <span className="text-sm text-ink-600">邮箱</span>
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="block">
          <span className="text-sm text-ink-600">密码 (≥ 8 位)</span>
          <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "注册中…" : "注册"}</button>
        <div className="text-center text-sm text-ink-500">
          已有账号？ <Link to="/login" className="text-ink-800 hover:underline">去登录</Link>
        </div>
      </form>
    </div>
  );
}

function extractError(err: unknown): string | null {
  if (typeof err === "object" && err && "response" in err) {
    const r = (err as { response?: { data?: { detail?: unknown } } }).response;
    const d = r?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg);
    if (typeof d === "object" && d && "code" in d) return String((d as { code?: string }).code);
  }
  return null;
}

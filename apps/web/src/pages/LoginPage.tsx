import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/store/auth";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = useAuth((s) => s.token);
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();

  if (token) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[400px] pt-10">
      <Card className="gap-0 border-line bg-card py-0 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="callno">V3·00</span>
          <h2 className="font-serif-cn text-[17px] tracking-[2px] text-lamp-deep">
            {mode === "login" ? "登录" : "注册"} · 架上寻书
          </h2>
        </div>
        <CardContent className="px-5 py-4">
          <div className="mb-4 flex text-[13px]">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 rounded-l border px-3 py-1.5 ${
                mode === "login"
                  ? "border-lamp bg-lamp text-[#f3efe4]"
                  : "border-line bg-white text-ink-soft hover:bg-page"}`}
            >登录</button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(""); }}
              className={`flex-1 rounded-r border border-l-0 px-3 py-1.5 ${
                mode === "register"
                  ? "border-lamp bg-lamp text-[#f3efe4]"
                  : "border-line bg-white text-ink-soft hover:bg-page"}`}
            >注册</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block text-[13px] text-ink-soft">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required minLength={2} maxLength={32}
                placeholder={mode === "register" ? "2~32 位，字母/数字/下划线/中文" : ""}
                className="mt-1 w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brass focus:ring-1 focus:ring-brass"
              />
            </label>
            <label className="block text-[13px] text-ink-soft">
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required minLength={6} maxLength={128}
                placeholder={mode === "register" ? "至少 6 位" : ""}
                className="mt-1 w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brass focus:ring-1 focus:ring-brass"
              />
            </label>
            {error && <p className="text-[13px] text-match">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

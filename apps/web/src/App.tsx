import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { HistoryPage } from "@/pages/HistoryPage";
import { LoginPage } from "@/pages/LoginPage";
import { SearchPage } from "@/pages/SearchPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { useAuth } from "@/store/auth";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function TopBar() {
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);
  const logout = useAuth((s) => s.logout);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `border border-l-0 border-[#f3efe4]/35 px-3.5 py-1.5 first:rounded-l first:border-l last:rounded-r hover:bg-white/10 ${
      isActive ? "bg-white/15 font-bold" : ""}`;

  return (
    <header className="border-b-[3px] border-brass bg-gradient-to-br from-lamp to-lamp-deep text-[#f3efe4]">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="flex items-center gap-3.5">
          <span className="grid h-[46px] w-[46px] place-items-center rounded border-2 border-brass bg-card font-serif-cn text-2xl font-bold text-lamp-deep shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
            架
          </span>
          <span>
            <span className="block font-serif-cn text-2xl tracking-[4px]">架上寻书</span>
            <span className="block text-[12.5px] tracking-wide opacity-80">
              拍一张书架，说出书名，红框告诉你它在哪
            </span>
          </span>
        </Link>
        {token && (
          <div className="flex flex-wrap items-center gap-4">
            <nav className="flex text-[13px]">
              <NavLink to="/" end className={navCls}>识别</NavLink>
              <NavLink to="/history" className={navCls}>记录</NavLink>
              <NavLink to="/search" className={navCls}>搜索</NavLink>
            </nav>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="opacity-90">{username}</span>
              <button
                type="button"
                onClick={logout}
                className="rounded border border-[#f3efe4]/35 px-2.5 py-1 hover:bg-white/10"
              >退出登录</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <main className="mx-auto max-w-[1080px] px-4 py-5">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="/search" element={<RequireAuth><SearchPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="mt-8 pb-10 text-center text-xs tracking-[2px] text-ink-soft">
        架上寻书 v3 · DeepSeek 视觉识别 · React + FastAPI
      </footer>
    </BrowserRouter>
  );
}

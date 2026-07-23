import { Boxes, Code2, LogOut, PackagePlus, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";

import { getMe, getStoredToken, storeToken } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { BrowsePage } from "./pages/BrowsePage";
import { DashboardPage } from "./pages/DashboardPage";
import { PublishPage } from "./pages/PublishPage";
import { SkillDetailPage } from "./pages/SkillDetailPage";
import type { HubUser } from "./types";

export default function App() {
  const [user, setUser] = useState<HubUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!getStoredToken()) {
      setAuthReady(true);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => storeToken(""))
      .finally(() => setAuthReady(true));
  }, []);

  function logout() {
    storeToken("");
    setUser(null);
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="topbar">
          <Link className="brand" to="/">
            <span className="brand-mark"><Boxes size={22} /></span>
            <span><strong>ZJ</strong> Skill Hub</span>
          </Link>
          <nav>
            <NavLink to="/">发现</NavLink>
            <NavLink to="/publish">发布</NavLink>
            {user && <NavLink to="/dashboard">我的 Skills</NavLink>}
          </nav>
          <div className="topbar-actions">
            <a className="icon-link" href="https://github.com" aria-label="GitHub"><Code2 size={18} /></a>
            {authReady && (user ? (
              <>
                <Link className="user-chip" to="/dashboard"><UserRound size={16} />{user.display_name}</Link>
                <button className="icon-link" onClick={logout} aria-label="退出"><LogOut size={18} /></button>
              </>
            ) : (
              <>
                <Link className="text-link" to="/auth">登录</Link>
                <Link className="small-cta" to="/auth"><PackagePlus size={16} />开始发布</Link>
              </>
            ))}
          </div>
        </header>
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/auth" element={<AuthPage user={user} onAuthenticated={setUser} />} />
          <Route path="/publish" element={<PublishPage user={user} />} />
          <Route path="/dashboard" element={<DashboardPage user={user} />} />
          <Route path="/skills/:namespace/:slug" element={<SkillDetailPage user={user} />} />
        </Routes>
        <footer>
          <span>ZJ Skill Hub · Group 11</span>
          <span>开放格式 · 不可变版本 · 安全校验</span>
        </footer>
      </div>
    </BrowserRouter>
  );
}

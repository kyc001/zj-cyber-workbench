import { PackagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { getMySkills } from "../api";
import { SkillCard } from "../components/SkillCard";
import type { HubUser, SkillSummary } from "../types";

export function DashboardPage({ user }: { user: HubUser | null }) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);

  useEffect(() => {
    if (user) getMySkills().then(setSkills).catch(() => setSkills([]));
  }, [user]);

  if (!user) return <Navigate to="/auth" state={{ from: "/dashboard" }} replace />;

  return (
    <main className="content-shell">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">CREATOR DASHBOARD</span>
          <h1>你好，{user.display_name}</h1>
          <p>管理你发布的 Skill 和不可变版本。</p>
        </div>
        <Link className="primary-button" to="/publish"><PackagePlus size={17} />发布新版本</Link>
      </div>
      {skills.length ? (
        <div className="skill-grid">
          {skills.map((skill) => <SkillCard key={`${skill.namespace}/${skill.slug}`} skill={skill} />)}
        </div>
      ) : (
        <div className="empty-state">你还没有发布 Skill。把第一个可复用工作流分享给社区吧。</div>
      )}
    </main>
  );
}

import { Download, Star } from "lucide-react";
import { Link } from "react-router-dom";

import type { SkillSummary } from "../types";

type SkillCardProps = {
  skill: SkillSummary;
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <Link className="skill-card" to={`/skills/${skill.namespace}/${skill.slug}`}>
      <div className="skill-card-topline">
        <span className="namespace-pill">@{skill.namespace}</span>
        <span className="version-pill">v{skill.latest_version}</span>
      </div>
      <h3>{skill.name}</h3>
      <p>{skill.summary}</p>
      <div className="tag-row">
        {skill.tags.slice(0, 4).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="skill-card-footer">
        <span><Download size={15} />{compactNumber(skill.downloads)}</span>
        <span><Star size={15} />{compactNumber(skill.stars)}</span>
        <span className="rating">{skill.rating_count ? `${skill.rating_average.toFixed(1)} / 5` : "暂无评分"}</span>
      </div>
    </Link>
  );
}

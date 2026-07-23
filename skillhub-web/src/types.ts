export type HubUser = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: HubUser;
};

export type HubNamespace = {
  slug: string;
  name: string;
  description: string;
  owner_username: string;
  public: boolean;
  skill_count: number;
  created_at: string;
};

export type SkillVersion = {
  version: string;
  changelog: string;
  sha256: string;
  size_bytes: number;
  scan_status: "passed" | "warning";
  scan_warnings: string[];
  published_at: string;
};

export type SkillSummary = {
  namespace: string;
  slug: string;
  name: string;
  summary: string;
  tags: string[];
  latest_version: string;
  downloads: number;
  stars: number;
  rating_average: number;
  rating_count: number;
  updated_at: string;
};

export type SkillDetail = SkillSummary & {
  description: string;
  visibility: string;
  author_username: string;
  versions: SkillVersion[];
  starred: boolean;
  my_rating: number | null;
};

export type SkillList = {
  items: SkillSummary[];
  total: number;
  page: number;
  page_size: number;
};

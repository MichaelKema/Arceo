export type AppTarget = { id: string; name: string; path: string };
export type Group = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  domains: string[];
  apps: AppTarget[];
};
export type Schedule = {
  id: string;
  name: string;
  group_ids: string[];
  days: number[];
  start: string;
  end: string;
  enabled: boolean;
};
export type Session = {
  id: string;
  name: string;
  group_ids: string[];
  started_at: number;
  ends_at: number;
  ended_at: number | null;
};
export type Config = {
  groups: Group[];
  schedules: Schedule[];
  sessions: Session[];
  active_session: Session | null;
  engine_enabled: boolean;
  safari_protection: boolean;
  daily_goal: number;
  user_name: string;
};
export type Runtime = {
  online: boolean;
  heartbeat: number;
  blocked_domains: number;
  blocked_apps: number;
  active_schedule_ids: string[];
  error: string | null;
};
export type Snapshot = {
  config: Config;
  runtime: Runtime;
  platform: string;
  safari?: { error: string | null };
  browser?: {
    prepared: boolean;
    connected: boolean;
    count: number;
    error: string | null;
    extension_path: string;
  };
};
export type Page =
  "Overview" | "Block lists" | "Schedules" | "Insights" | "Settings";

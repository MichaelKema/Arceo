import { invoke, isTauri } from "@tauri-apps/api/core";
import defaults from "./defaults.json";
import type { Config, Snapshot, Session, Schedule } from "./types";
export const native = isTauri();
const KEY = "arceo-preview-v1";
const emptyRuntime = {
  online: false,
  heartbeat: 0,
  blocked_domains: 0,
  blocked_apps: 0,
  active_schedule_ids: [],
  error: null,
};
function readPreview(): Config {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    if (data?.groups && data?.sessions && data?.schedules) return data;
  } catch {
    /* use bundled defaults */
  }
  return structuredClone(defaults) as Config;
}
function persist(config: Config) {
  localStorage.setItem(KEY, JSON.stringify(config));
  return config;
}
export async function snapshot(): Promise<Snapshot> {
  if (native) return invoke("get_snapshot");
  const config = readPreview();
  if (
    config.active_session &&
    config.active_session.ends_at <= Date.now() / 1000
  ) {
    config.sessions.unshift(config.active_session);
    config.active_session = null;
    persist(config);
  }
  return { config, runtime: emptyRuntime, platform: "browser" };
}
export async function save(config: Config): Promise<Config> {
  return native ? invoke("save_config", { config }) : persist(config);
}
export async function enableEngine() {
  if (native) await invoke("enable_engine");
}
export async function disableEngine() {
  if (native) await invoke("disable_engine");
}
export async function startSession(
  duration: number,
  groupIds: string[],
  name: string,
): Promise<Config> {
  if (native) return invoke("start_session", { duration, groupIds, name });
  const config = readPreview();
  const now = Math.floor(Date.now() / 1000);
  config.active_session = {
    id: crypto.randomUUID(),
    name,
    group_ids: groupIds,
    started_at: now,
    ends_at: now + duration * 60,
    ended_at: null,
  };
  return persist(config);
}
export async function stopSession(): Promise<Config> {
  if (native) return invoke("stop_session");
  const config = readPreview();
  if (config.active_session) {
    config.active_session.ended_at = Math.floor(Date.now() / 1000);
    config.sessions.unshift(config.active_session);
    config.active_session = null;
  }
  return persist(config);
}
export function domain(input: string): string {
  const trimmed = input.trim().replace(/^\*\./, "");
  const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    host.length > 253 ||
    !host.includes(".") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host
      .split(".")
      .some((p) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))
  )
    throw new Error(
      "Enter a website like reddit.com, without a port or IP address.",
    );
  return host;
}
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return m >= 60
    ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim()
    : `${m}m`;
}
export function sessionMinutes(session: Session, now = Date.now() / 1000) {
  return Math.max(
    0,
    (Math.min(session.ends_at, session.ended_at ?? now) - session.started_at) /
      60,
  );
}
export function clockTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function nextOccurrence(
  schedule: Schedule,
  now = new Date(),
): Date | null {
  if (!schedule.enabled) return null;
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    const [h, m] = schedule.start.split(":").map(Number);
    date.setHours(h, m, 0, 0);
    if (schedule.days.includes((date.getDay() + 6) % 7) && date > now)
      return date;
  }
  return null;
}
export function scheduleActive(s: Schedule, date = new Date()) {
  if (!s.enabled) return false;
  const day = (date.getDay() + 6) % 7,
    time = date.getHours() * 60 + date.getMinutes();
  const toM = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toM(s.start),
    end = toM(s.end);
  return start < end
    ? s.days.includes(day) && time >= start && time < end
    : start > end &&
        ((time >= start && s.days.includes(day)) ||
          (time < end && s.days.includes((day + 6) % 7)));
}
export function dailyMinutes(
  sessions: Session[],
  date: Date,
  now = Date.now() / 1000,
) {
  const begin = new Date(date);
  begin.setHours(0, 0, 0, 0);
  const end = new Date(begin);
  end.setDate(end.getDate() + 1);
  return sessions.reduce(
    (total, s) =>
      total +
      Math.max(
        0,
        Math.min(s.ends_at, s.ended_at ?? now, end.getTime() / 1000) -
          Math.max(s.started_at, begin.getTime() / 1000),
      ) /
        60,
    0,
  );
}

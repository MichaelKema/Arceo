import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LayoutDashboard,
  Shield,
  CalendarDays,
  ChartNoAxesCombined,
  Settings2,
  ChevronRight,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Clock3,
  Play,
  Square,
  Check,
  CheckCheck,
  X,
  Search,
  Globe,
  Monitor,
  MoreHorizontal,
  Sparkles,
  Zap,
  CircleHelp,
  Command,
  ExternalLink,
  Laptop,
  ShieldCheck,
  Trash2,
  Pencil,
  LoaderCircle,
  Sun,
  Moon,
  Bell,
  FolderPlus,
  Coffee,
  AlertCircle,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type {
  Config,
  Group,
  Schedule,
  Snapshot,
  Page,
  AppTarget,
} from "./types";
import {
  native,
  snapshot,
  save,
  enableEngine,
  disableEngine,
  startSession,
  stopSession,
  domain,
  formatDuration,
  sessionMinutes,
  clockTime,
  dayLabels,
  nextOccurrence,
  scheduleActive,
  dailyMinutes,
} from "./lib";
import { GroupIcon, Modal, Toggle, Empty } from "./components/ui";

const nav: { name: Page; icon: LucideIcon }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Block lists", icon: Shield },
  { name: "Schedules", icon: CalendarDays },
  { name: "Insights", icon: ChartNoAxesCombined },
];
const id = () => crypto.randomUUID();
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>("Overview");
  const [now, setNow] = useState(Date.now());
  const [duration, setDuration] = useState(45);
  const [selected, setSelected] = useState<string[]>([
    "social",
    "entertainment",
  ]);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [startModal, setStartModal] = useState(false);
  const [startError, setStartError] = useState("");
  const [stopModal, setStopModal] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState("");
  const [listType, setListType] = useState("All lists");
  const [initError, setInitError] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setData(await snapshot());
      setInitError("");
    } catch (e) {
      setInitError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!data) return;
    setSelected((current) => {
      const valid = current.filter((groupId) =>
        data.config.groups.some((group) => group.id === groupId),
      );
      return valid.length === current.length ? current : valid;
    });
  }, [data]);

  async function commit(config: Config) {
    const result = await save(config);
    setData((old) => (old ? { ...old, config: result } : old));
    return result;
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }
  const config = data?.config;
  const active = config?.active_session;
  const activeSchedules =
    config?.schedules.filter((s) => scheduleActive(s)) || [];
  const engineReady = !!data?.runtime.online && !data.runtime.error;
  const allSessions = config
    ? [...config.sessions, ...(active ? [active] : [])]
    : [];
  const todayMinutes = dailyMinutes(allSessions, new Date(now), now / 1000);
  const completed =
    config?.sessions.filter(
      (s) =>
        !s.ended_at &&
        new Date(s.ends_at * 1000).toDateString() ===
          new Date(now).toDateString(),
    ).length || 0;
  const totalSites = new Set(config?.groups.flatMap((g) => g.domains)).size;
  const remaining = active
    ? Math.min(
        active.ends_at - active.started_at,
        Math.max(0, Math.ceil(active.ends_at - now / 1000)),
      )
    : duration * 60;
  const timerDisplay = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const progress = active
    ? 1 - remaining / (active.ends_at - active.started_at)
    : 0;
  const upcoming =
    config?.schedules
      .filter((s) => s.enabled)
      .map((s) => ({ schedule: s, next: nextOccurrence(s) }))
      .filter((s) => s.next)
      .sort((a, b) => a.next!.getTime() - b.next!.getTime())
      .slice(0, 3) || [];
  function newSchedule() {
    setEditingSchedule({
      id: id(),
      name: "",
      group_ids: config?.groups.slice(0, 1).map((g) => g.id) || [],
      days: [0, 1, 2, 3, 4],
      start: "09:00",
      end: "11:00",
      enabled: true,
    });
  }
  function newGroup() {
    setEditingGroup({
      id: id(),
      name: "",
      description: "A little space for what matters.",
      color: "purple",
      icon: "custom",
      domains: [],
      apps: [],
    });
  }
  function go(next: Page) {
    setPage(next);
    setFilter("");
  }
  async function begin() {
    if (busy) return;
    setBusy(true);
    setStartError("");
    try {
      if (!selected.length) throw new Error("Choose at least one block list.");
      if (native && !engineReady) await enableEngine();
      const next = await startSession(duration, selected, "Deep work");
      setNow(Date.now());
      setData((old) => (old ? { ...old, config: next } : old));
      setStartModal(false);
      await refresh();
      notify(
        native
          ? "Your focus session has started. You’ve got this."
          : "Preview timer started. Desktop blocking requires the native app.",
      );
    } catch (error) {
      setStartError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function requestStart(ids?: string[]) {
    setStartError("");
    if (ids) setSelected(ids);
    setStartModal(true);
  }
  if (!config || !data)
    return (
      <div className="loading-screen">
        <ArceoLogo />
        <h2>
          {initError
            ? "Couldn’t open your workspace"
            : "Making a little space…"}
        </h2>
        {initError ? (
          <>
            <p>{initError}</p>
            <button className="button primary" onClick={() => void refresh()}>
              Try again
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  const visibleGroups = config.groups.filter(
    (g) =>
      (
        g.name +
        " " +
        g.domains.join(" ") +
        " " +
        g.apps.map((a) => a.name).join(" ")
      )
        .toLowerCase()
        .includes(filter.toLowerCase()) &&
      (listType === "All lists" ||
        (listType === "With apps" ? g.apps.length > 0 : g.domains.length > 0)),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => go("Overview")}
          aria-label="Arceo home"
        >
          <ArceoLogo />
          <span>
            arceo<span className="brand-dot">.</span>
          </span>
        </button>
        <button className="workspace-picker" onClick={() => go("Settings")}>
          <span className="workspace-avatar">
            <Sun size={17} />
          </span>
          <span>
            Personal space<small>Make time for you</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button className="search-trigger" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span>Quick search</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              onClick={() => go(name)}
              className={`nav-item ${page === name ? "selected" : ""}`}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{name}</span>
              {name === "Block lists" && (
                <span className="nav-count">{config.groups.length}</span>
              )}
              {name === "Schedules" && config.schedules.length > 0 && (
                <span className="nav-count">{config.schedules.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-lists">
          <div className="nav-label">
            YOUR BLOCK LISTS
            <button aria-label="New block list" onClick={newGroup}>
              <Plus size={14} />
            </button>
          </div>
          {config.groups.slice(0, 5).map((g) => (
            <button
              key={g.id}
              className="sidebar-group"
              onClick={() => setEditingGroup(structuredClone(g))}
            >
              <span className={`color-dot ${g.color}`} />
              {g.name}
              <span>{g.domains.length + g.apps.length}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-spark">
              <Sparkles size={17} />
            </span>
            <strong>A little less noise.</strong>
            <p>A lot more possibility.</p>
            <div className="platforms">
              <Laptop size={13} />
              <span>Made for macOS & Windows</span>
            </div>
          </div>
          <button
            aria-label="Settings"
            className={`nav-item ${page === "Settings" ? "selected" : ""}`}
            onClick={() => go("Settings")}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button
            aria-label="Help and getting started"
            className="nav-item"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
            <span>Help & getting started</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">
              {config.user_name === "there"
                ? "Y"
                : config.user_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>
                {config.user_name === "there"
                  ? "Your workspace"
                  : config.user_name}
              </strong>
              <span>Local & private</span>
            </div>
            <span
              className="private-dot"
              title="Your data stays on this device"
            />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="crumb-icon">
              <LayoutDashboard size={15} />
            </span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className={`environment-pill ${native ? (engineReady ? "ready" : "") : "preview"}`}
              onClick={() => (native ? go("Settings") : setHelp(true))}
            >
              <span className="status-dot" />
              {native
                ? engineReady
                  ? "Engine running"
                  : "Engine stopped"
                : "Browser preview"}
              {!native && <ExternalLink size={11} />}
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="View session status"
              onClick={() =>
                notify(
                  active
                    ? `${timerDisplay} remaining in your focus session.`
                    : activeSchedules.length
                      ? `${activeSchedules.length} scheduled block${activeSchedules.length > 1 ? "s are" : " is"} active.`
                      : "All quiet. Your next focus session is up to you.",
                )
              }
            >
              <Bell size={17} />
              {active && <span className="notification-dot" />}
            </button>
            <button
              className="topbar-avatar"
              onClick={() => go("Settings")}
              aria-label="Profile settings"
            >
              {config.user_name === "there"
                ? "Y"
                : config.user_name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          {native && config.engine_enabled && !data.runtime.online && (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>
                The blocking engine is stopped. Start a focus session or enable
                it in Settings.
              </span>
              <button onClick={() => go("Settings")}>
                Open settings
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          {native &&
            data.platform === "macos" &&
            (!config.safari_protection || data.safari?.error) && (
              <div className="error-banner">
                <AlertCircle size={16} />
                <span>
                  {data.safari?.error ||
                    "Using Safari? Enable Safari protection to block cached pages and connections during focus sessions."}
                </span>
                <button onClick={() => go("Settings")}>
                  Open settings <ArrowRight size={13} />
                </button>
              </div>
            )}
          {native &&
            data.platform === "windows" &&
            (!data.browser?.connected || data.browser.error) && (
              <div className="error-banner">
                <Globe size={16} />
                <span>
                  {data.browser?.error ||
                    "Using Chrome or Edge? Set up browser protection to cover cached pages, existing connections, and secure DNS."}
                </span>
                <button onClick={() => go("Settings")}>
                  Set up browser protection <ArrowRight size={13} />
                </button>
              </div>
            )}
          {data.runtime.error && (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{data.runtime.error}</span>
              <button onClick={() => go("Settings")}>
                Open settings
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "Overview" ? (
                  <>
                    <Sun size={14} /> YOUR TIME, ON PURPOSE
                  </>
                ) : page === "Block lists" ? (
                  "LESS DISTRACTION, BY DESIGN"
                ) : page === "Schedules" ? (
                  "BUILD YOUR RHYTHM"
                ) : page === "Insights" ? (
                  "SMALL STEPS ADD UP"
                ) : (
                  "MAKE YOURSELF AT HOME"
                )}
              </div>
              <h1>
                {page === "Overview"
                  ? `A little more focused${config.user_name === "there" ? "" : `, ${config.user_name}`}.`
                  : page === "Block lists"
                    ? "Choose what can wait."
                    : page === "Schedules"
                      ? "Make focus a habit."
                      : page === "Insights"
                        ? "Look at you, making time."
                        : "Your space. Your rules."}
              </h1>
              <p>
                {page === "Overview"
                  ? "Clear the distractions. Make space for your best work."
                  : page === "Block lists"
                    ? "Your distractions, neatly grouped. Block a little, get a lot back."
                    : page === "Schedules"
                      ? "Give your best hours a little protection. We’ll take care of the rest."
                      : page === "Insights"
                        ? "A little perspective on the time you’re making for what matters."
                        : "A few small settings for a calmer, more intentional day."}
              </p>
            </div>
            <div className="heading-action">
              {page === "Overview" ? (
                <div className="date-label">
                  <CalendarDays size={15} />
                  {new Date(now).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              ) : page === "Block lists" ? (
                <button className="button primary" onClick={newGroup}>
                  <Plus size={16} />
                  New block list
                </button>
              ) : page === "Schedules" ? (
                <button className="button primary" onClick={newSchedule}>
                  <Plus size={16} />
                  New schedule
                </button>
              ) : null}
            </div>
          </div>

          {(page === "Overview" || page === "Insights") && (
            <div className="stats-grid">
              <Stat
                icon={Clock3}
                color="purple"
                label="Focus time today"
                value={formatDuration(todayMinutes)}
                detail={`of your ${formatDuration(config.daily_goal)} daily goal`}
                progress={Math.min(
                  100,
                  (todayMinutes / config.daily_goal) * 100,
                )}
              />
              <Stat
                icon={CheckCheck}
                color="mint"
                label="Sessions completed"
                value={String(completed).padStart(2, "0")}
                detail="One session at a time"
              />
              <Stat
                icon={Shield}
                color="coral"
                label="Websites in your lists"
                value={String(totalSites).padStart(2, "0")}
                detail={`${config.groups.reduce((n, g) => n + g.apps.length, 0)} desktop apps added`}
              />
              <Stat
                icon={CalendarDays}
                color="blue"
                label="Active schedules"
                value={String(
                  config.schedules.filter((s) => s.enabled).length,
                ).padStart(2, "0")}
                detail={
                  activeSchedules.length
                    ? `${activeSchedules.length} running right now`
                    : "Your routine, on autopilot"
                }
              />
            </div>
          )}
          {page === "Overview" && (
            <>
              <div className="focus-grid">
                <section className={`focus-card ${active ? "is-active" : ""}`}>
                  <div className="card-label">
                    <span>
                      <span
                        className={`color-dot ${active ? "mint" : "purple"}`}
                      />
                      {active ? "IN YOUR FOCUS ERA" : "A LITTLE SPACE TO FOCUS"}
                    </span>
                    <span className="subtle-badge">
                      <Zap size={12} />
                      {active ? "In progress" : "Deep work"}
                    </span>
                  </div>
                  <div className="focus-content">
                    <div className="focus-copy">
                      <h2>
                        {active
                          ? "You’re in your zone."
                          : "One thing at a time."}
                      </h2>
                      <p>
                        {active
                          ? "The outside world can wait.\nStay with what matters."
                          : "Big ideas start with a little focus.\nGive yourself some uninterrupted time."}
                      </p>
                      <div className="focus-presets">
                        {[25, 45, 60].map((m) => (
                          <button
                            disabled={!!active}
                            key={m}
                            className={duration === m ? "chosen" : ""}
                            onClick={() => setDuration(m)}
                          >
                            {m} min
                          </button>
                        ))}
                        <button
                          disabled={!!active}
                          className={
                            ![25, 45, 60].includes(duration) ? "chosen" : ""
                          }
                          onClick={() => setStartModal(true)}
                        >
                          Custom
                          <Plus size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="timer-orbit">
                      <svg viewBox="0 0 204 204" aria-hidden="true">
                        <defs>
                          <linearGradient id="timer-gradient">
                            <stop offset="0%" stopColor="#d5c6ff" />
                            <stop offset="100%" stopColor="#9d80f5" />
                          </linearGradient>
                        </defs>
                        <circle
                          className="orbit-outer"
                          cx="102"
                          cy="102"
                          r="99"
                        />
                        <circle
                          className="orbit-base"
                          cx="102"
                          cy="102"
                          r="85"
                        />
                        <circle
                          className="orbit-progress"
                          cx="102"
                          cy="102"
                          r="85"
                          strokeDasharray="534"
                          strokeDashoffset={active ? 534 * progress : 40}
                        />
                        <circle
                          className="orbit-inner"
                          cx="102"
                          cy="102"
                          r="73"
                        />
                      </svg>
                      <div className="timer-text">
                        <Timer size={18} />
                        <strong>{timerDisplay}</strong>
                        <span>
                          {active ? "TIME REMAINING" : "MINUTES OF POSSIBILITY"}
                        </span>
                      </div>
                      <span className="orbit-spark one">✧</span>
                      <span className="orbit-spark two">✦</span>
                    </div>
                  </div>
                  <div className="focus-card-bottom">
                    <div>
                      <span className="field-eyebrow">
                        {active
                          ? "BLOCK LISTS IN THIS SESSION"
                          : "KEEP THESE OUT OF THE PICTURE"}
                      </span>
                      <div className="focus-groups">
                        {config.groups.map((g) => (
                          <button
                            disabled={!!active}
                            key={g.id}
                            onClick={() =>
                              setSelected((ids) =>
                                ids.includes(g.id)
                                  ? ids.filter((x) => x !== g.id)
                                  : [...ids, g.id],
                              )
                            }
                            className={
                              (active?.group_ids || selected).includes(g.id)
                                ? "checked"
                                : ""
                            }
                          >
                            <span className={`color-dot ${g.color}`} />
                            {g.name}
                            {(active?.group_ids || selected).includes(g.id) && (
                              <Check size={11} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      className={`button start-button ${active ? "stop-button" : "primary"}`}
                      disabled={busy || (!active && !selected.length)}
                      onClick={() =>
                        active ? setStopModal(true) : requestStart()
                      }
                    >
                      {active ? (
                        <>
                          <Square size={13} />
                          End session
                        </>
                      ) : (
                        <>
                          <Play size={14} fill="currentColor" />
                          Start focus session
                        </>
                      )}
                    </button>
                  </div>
                  {!native && active && (
                    <div className="preview-caption">
                      Preview timer only · websites and apps are not blocked in
                      your browser
                    </div>
                  )}
                </section>
                <section className="card upcoming-card">
                  <div className="section-card-header">
                    <h3>
                      <CalendarDays size={17} />
                      Up next
                    </h3>
                    <button
                      className="icon-button"
                      aria-label="New schedule"
                      onClick={newSchedule}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                  {upcoming.length ? (
                    <div className="upcoming-list">
                      {upcoming.map(({ schedule: s, next }) => (
                        <button
                          className="upcoming-item"
                          key={s.id}
                          onClick={() => setEditingSchedule(structuredClone(s))}
                        >
                          <div className="schedule-mini-icon">
                            <Sun size={18} />
                          </div>
                          <div>
                            <strong>{s.name}</strong>
                            <span>
                              {next!.toLocaleDateString("en-US", {
                                weekday: "short",
                              })}{" "}
                              · {clockTime(s.start)} – {clockTime(s.end)}
                            </span>
                            <small>
                              {s.group_ids.length} block list
                              {s.group_ids.length === 1 ? "" : "s"}
                            </small>
                          </div>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="schedule-invite">
                      <div className="mini-calendar">
                        <div className="mini-calendar-top">
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="mini-calendar-dots">
                          {Array.from({ length: 12 }, (_, i) => (
                            <span
                              key={i}
                              className={
                                [2, 5, 6, 9].includes(i) ? "filled" : ""
                              }
                            />
                          ))}
                        </div>
                        <span className="mini-calendar-check">
                          <Check size={13} />
                        </span>
                      </div>
                      <h3>Good habits, on repeat.</h3>
                      <p>
                        Schedule your focus time.
                        <br />
                        Let your routine do the rest.
                      </p>
                      <button
                        className="button secondary"
                        onClick={newSchedule}
                      >
                        <Plus size={14} />
                        Create a schedule
                      </button>
                    </div>
                  )}
                  <button
                    className="card-footer-link"
                    onClick={() => go("Schedules")}
                  >
                    View all schedules
                    <ArrowRight size={14} />
                  </button>
                </section>
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Your block lists <span>{config.groups.length}</span>
                  </h2>
                  <p>Less temptation. A clearer head.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => go("Block lists")}
                >
                  Manage lists
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="groups-grid">
                {config.groups.slice(0, 4).map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    active={
                      !!active?.group_ids.includes(g.id) ||
                      activeSchedules.some((s) => s.group_ids.includes(g.id))
                    }
                    edit={() => setEditingGroup(structuredClone(g))}
                    activate={() => requestStart([g.id])}
                  />
                ))}
              </div>
              <div className="bottom-note">
                <span>
                  <ShieldCheck size={14} />
                  Your focus is personal. Your data stays on this device.
                </span>
                <span>
                  A little better, every day.
                  <Sparkles size={13} />
                </span>
              </div>
            </>
          )}
          {page === "Block lists" && (
            <>
              <div className="list-toolbar">
                <div className="tabs">
                  {["All lists", "With websites", "With apps"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setListType(t)}
                      className={listType === t ? "active" : ""}
                    >
                      {t}
                      {t === "All lists" && <span>{config.groups.length}</span>}
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={15} />
                  <input
                    placeholder="Find a list or website…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
              </div>
              <div className="groups-grid list-page">
                {visibleGroups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    active={
                      !!active?.group_ids.includes(g.id) ||
                      activeSchedules.some((s) => s.group_ids.includes(g.id))
                    }
                    edit={() => setEditingGroup(structuredClone(g))}
                    activate={() => requestStart([g.id])}
                  />
                ))}
                <button className="new-list-card" onClick={newGroup}>
                  <span>
                    <Plus size={24} />
                  </span>
                  <h3>A list of your own</h3>
                  <p>Whatever gets in your way.</p>
                  <strong>
                    Create a block list
                    <ArrowUpRight size={14} />
                  </strong>
                </button>
              </div>
              {visibleGroups.length === 0 && filter && (
                <Empty icon={Search} title="No lists found">
                  <p>Try a different name or website.</p>
                </Empty>
              )}
              <div className="info-strip">
                <Sparkles size={18} />
                <div>
                  <strong>Make it yours.</strong>
                  <p>
                    Add websites and desktop apps to any list. Your presets are
                    just a starting point.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === "Schedules" && (
            <>
              <div className="schedule-summary">
                <CalendarDays size={19} />
                <span>
                  <strong>
                    {config.schedules.filter((s) => s.enabled).length} schedules
                    enabled
                  </strong>{" "}
                  ·{" "}
                  {Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone.replace(/_/g, " ")}
                </span>
                <span className="subtle-badge">Local time</span>
              </div>
              {!native && (
                <div className="info-strip compact">
                  <Monitor size={17} />
                  <p>
                    Schedules are saved in this preview. Open the desktop app to
                    run them automatically.
                  </p>
                </div>
              )}
              {config.schedules.length ? (
                <div className="schedule-list">
                  {config.schedules.map((s) => (
                    <div className="schedule-row card" key={s.id}>
                      <div
                        className={`schedule-row-icon ${scheduleActive(s) ? "mint" : "purple"}`}
                      >
                        <CalendarDays size={24} />
                      </div>
                      <div className="schedule-row-main">
                        <h3>
                          {s.name}
                          {scheduleActive(s) && (
                            <span className="running-badge">
                              {native ? "Running now" : "Scheduled now"}
                            </span>
                          )}
                        </h3>
                        <p>
                          {clockTime(s.start)} <span>→</span> {clockTime(s.end)}
                          {s.start > s.end && <small> · next day</small>}
                        </p>
                        <div className="day-chips">
                          {dayLabels.map((d, i) => (
                            <span
                              key={d}
                              className={s.days.includes(i) ? "active" : ""}
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="schedule-row-groups">
                        {s.group_ids.map((gid) => {
                          const g = config.groups.find((g) => g.id === gid);
                          return g ? (
                            <span key={gid}>
                              <GroupIcon group={g} small />
                              {g.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${s.name}`}
                        onClick={() => setEditingSchedule(structuredClone(s))}
                      >
                        <Pencil size={16} />
                      </button>
                      <Toggle
                        checked={s.enabled}
                        disabled={busy}
                        label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                        onChange={() =>
                          void action(async () => {
                            if (!s.enabled && native && !engineReady)
                              await enableEngine();
                            await commit({
                              ...config,
                              schedules: config.schedules.map((item) =>
                                item.id === s.id
                                  ? { ...item, enabled: !s.enabled }
                                  : item,
                              ),
                            });
                            notify(
                              s.enabled
                                ? "Schedule paused."
                                : "Schedule enabled.",
                            );
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <section className="card schedule-empty">
                  <Empty icon={CalendarDays} title="Your routine starts here.">
                    <p>
                      Protect your mornings, reclaim your evenings,
                      <br />
                      or make a little room for deep work.
                    </p>
                    <button className="button primary" onClick={newSchedule}>
                      <Plus size={16} />
                      Create your first schedule
                    </button>
                  </Empty>
                </section>
              )}
              <div className="schedule-ideas">
                <h3>A little inspiration</h3>
                <div>
                  {[
                    {
                      name: "Morning deep work",
                      start: "09:00",
                      end: "11:00",
                      icon: Sun,
                      color: "purple",
                      text: "Start the day with a clear head.",
                    },
                    {
                      name: "An afternoon reset",
                      start: "14:00",
                      end: "15:30",
                      icon: Coffee,
                      color: "coral",
                      text: "Make a little space after lunch.",
                    },
                    {
                      name: "Wind down",
                      start: "21:00",
                      end: "23:00",
                      icon: Moon,
                      color: "blue",
                      text: "Less scrolling. Better evenings.",
                    },
                  ].map((s) => (
                    <button
                      key={s.name}
                      className="card idea-card"
                      onClick={() =>
                        setEditingSchedule({
                          id: id(),
                          name: s.name,
                          group_ids: config.groups.slice(0, 2).map((g) => g.id),
                          days: [0, 1, 2, 3, 4],
                          start: s.start,
                          end: s.end,
                          enabled: true,
                        })
                      }
                    >
                      <span className={`group-icon ${s.color}`}>
                        <s.icon size={22} />
                      </span>
                      <h3>{s.name}</h3>
                      <p>{s.text}</p>
                      <span>
                        {clockTime(s.start)} – {clockTime(s.end)}
                        <Plus size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {page === "Insights" && (
            <>
              <section className="card insights-card">
                <div className="section-card-header">
                  <div>
                    <h2>A little more time for you.</h2>
                    <p>
                      Your focus over the last seven days
                      {!native ? " · preview timers" : ""}
                    </p>
                  </div>
                  <span className="subtle-badge">Last 7 days</span>
                </div>
                <div className="weekly-chart">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(now);
                    d.setDate(d.getDate() - 6 + i);
                    const val = dailyMinutes(allSessions, d, now / 1000);
                    return (
                      <div
                        className={`chart-day ${i === 6 ? "today" : ""}`}
                        key={i}
                      >
                        <span>{formatDuration(val)}</span>
                        <div className="chart-track">
                          <div
                            style={{
                              height: `${Math.max(
                                2,
                                Math.min(
                                  100,
                                  (val /
                                    Math.max(
                                      config.daily_goal,
                                      ...Array.from({ length: 7 }, (_, j) => {
                                        const dt = new Date(now);
                                        dt.setDate(dt.getDate() - j);
                                        return dailyMinutes(
                                          allSessions,
                                          dt,
                                          now / 1000,
                                        );
                                      }),
                                    )) *
                                    100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                        <strong>
                          {i === 6
                            ? "Today"
                            : d.toLocaleDateString("en-US", {
                                weekday: "short",
                              })}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="card history-card">
                <div className="section-card-header">
                  <h3>Recent sessions</h3>
                  <span className="muted">{config.sessions.length} total</span>
                </div>
                {config.sessions.length ? (
                  <div className="history-table">
                    <div className="history-table-head">
                      <span>Session</span>
                      <span>Date</span>
                      <span>Focus time</span>
                      <span>Status</span>
                    </div>
                    {config.sessions.slice(0, 20).map((s) => (
                      <div className="history-table-row" key={s.id}>
                        <span>
                          <span className="history-icon">
                            <Zap size={15} />
                          </span>
                          <strong>{s.name || "Deep work"}</strong>
                        </span>
                        <span>
                          {new Date(s.started_at * 1000).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" },
                          )}{" "}
                          ·{" "}
                          {new Date(s.started_at * 1000).toLocaleTimeString(
                            "en-US",
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </span>
                        <span>{formatDuration(sessionMinutes(s))}</span>
                        <span
                          className={`session-status ${s.ended_at ? "ended" : "complete"}`}
                        >
                          {s.ended_at ? "Ended early" : "Completed"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty icon={Timer} title="Every good habit starts with one.">
                    <p>Your sessions will show up here. Ready when you are.</p>
                    <button
                      className="button secondary"
                      onClick={() => go("Overview")}
                    >
                      Find your focus
                      <ArrowRight size={14} />
                    </button>
                  </Empty>
                )}
              </section>
            </>
          )}
          {page === "Settings" && (
            <div className="settings-grid">
              <section className="card settings-card">
                <div className="section-card-header">
                  <h3>
                    <ShieldCheck size={18} />
                    Desktop blocking
                  </h3>
                  <span
                    className={`environment-pill ${engineReady ? "ready" : ""}`}
                  >
                    <span className="status-dot" />
                    {engineReady ? "Running" : "Stopped"}
                  </span>
                </div>
                <p>
                  Arceo’s native engine blocks websites across browsers and
                  closes selected apps while a session or schedule is active.
                </p>
                <div className="settings-callout">
                  <Monitor size={21} />
                  <div>
                    <strong>
                      {native
                        ? `Running on ${data.platform === "macos" ? "macOS" : "Windows"}`
                        : "You’re in browser preview"}
                    </strong>
                    <p>
                      {native
                        ? "Enable the engine with your OS administrator prompt. It keeps schedules running when you close this window."
                        : "Try the interface, create your lists, and preview timers. Real blocking runs in the Rust desktop app."}
                    </p>
                  </div>
                </div>
                <div className="settings-facts">
                  <span>
                    <Check size={14} />
                    Schedules work while the window is closed
                  </span>
                  <span>
                    <Check size={14} />
                    Website rules are removed when a block ends
                  </span>
                  <span>
                    <Check size={14} />
                    System processes and Arceo are protected
                  </span>
                </div>
                {native ? (
                  <button
                    className={`button ${engineReady ? "secondary" : "primary"}`}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (engineReady) {
                          await disableEngine();
                          notify(
                            "Engine disabled. All Arceo blocks are being removed.",
                          );
                        } else {
                          await enableEngine();
                          notify("Engine running. You’re ready to focus.");
                        }
                        await refresh();
                      })
                    }
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Shield size={15} />
                    )}{" "}
                    {engineReady
                      ? "Disable engine & unblock"
                      : "Enable blocking engine"}
                  </button>
                ) : (
                  <div className="preview-instructions">
                    <Command size={16} />
                    <code>npm run tauri dev</code>
                    <span>Run from your project folder</span>
                  </div>
                )}
                {native && (
                  <button
                    className="text-button recovery-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await disableEngine();
                        await refresh();
                        notify(
                          "All Arceo blocks are being removed. Schedules remain saved.",
                        );
                      })
                    }
                  >
                    Remove all Arceo blocks
                    <ArrowRight size={13} />
                  </button>
                )}
                {native && (
                  <div className="settings-callout">
                    <Globe size={21} />
                    <div>
                      <strong>
                        Chrome &amp; Edge protection ·{" "}
                        {data.browser?.connected && !data.browser.error
                          ? "Connected"
                          : "Setup needed"}
                      </strong>
                      <p>
                        Blocks selected sites inside your browser, including
                        existing connections and subdomains. An offline focus
                        page replaces already-open blocked tabs. Tab addresses
                        stay inside the browser; no browsing history or page
                        content is sent to Arceo.
                      </p>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await invoke("prepare_browser_protection");
                            await refresh();
                            notify(
                              "Local browser connection prepared. Load the Arceo extension in Chrome or Edge to finish setup.",
                            );
                          })
                        }
                      >
                        Prepare browser protection
                      </button>
                      {data.browser?.prepared && (
                        <>
                          <ol>
                            <li>
                              Open <code>chrome://extensions</code> or{" "}
                              <code>edge://extensions</code>.
                            </li>
                            <li>
                              Turn on Developer mode, select Load unpacked, then
                              choose this folder:
                            </li>
                          </ol>
                          <input
                            aria-label="Browser extension folder"
                            readOnly
                            value={data.browser.extension_path}
                            onFocus={(event) => event.currentTarget.select()}
                            style={{ width: "100%" }}
                          />
                          <p>
                            Install in each browser profile you use. Enable
                            “Allow in incognito” in the extension’s details if
                            you want to block private windows too. Setup uses
                            files bundled with this app; internet is not
                            required.
                          </p>
                        </>
                      )}
                      {data.browser?.error && (
                        <p role="alert">{data.browser.error}</p>
                      )}
                    </div>
                  </div>
                )}
                {native && data.platform === "macos" && (
                  <div className="settings-callout">
                    <Globe size={21} />
                    <div>
                      <strong>
                        Safari protection{" "}
                        {config.safari_protection && !data.safari?.error
                          ? "· Enabled"
                          : "· Setup needed"}
                      </strong>
                      <p>
                        Checks Safari tab addresses locally and replaces blocked
                        sites with an offline focus page, including cached
                        connections and all subdomains. No browsing addresses
                        are saved or shared.
                      </p>
                      <p>
                        Open Safari, then enable protection and allow Arceo to
                        control Safari in the macOS prompt. Closing this window
                        keeps protection running; Quit Arceo ends blocking.
                      </p>
                      {data.safari?.error && (
                        <p role="alert">{data.safari.error}</p>
                      )}
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await invoke("set_safari_protection", {
                              enabled: true,
                            });
                            await refresh();
                            notify(
                              "Safari protection enabled. Active timers and schedules apply immediately.",
                            );
                          })
                        }
                      >
                        {config.safari_protection && !data.safari?.error
                          ? "Check Safari permission"
                          : "Enable Safari protection"}
                      </button>
                      {config.safari_protection && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await invoke("set_safari_protection", {
                                enabled: false,
                              });
                              await refresh();
                            })
                          }
                        >
                          Disable Safari protection
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <p className="fine-print">
                  After a restart, open Arceo and enable the engine again.
                  Blocking apps closes their processes; save your work first.
                  Website rules cover exact domains and www; add other
                  subdomains separately. VPNs, proxies, existing connections, or
                  secure DNS can affect website blocking.
                </p>
              </section>
              <div>
                <section className="card settings-card">
                  <div className="section-card-header">
                    <h3>
                      <Sun size={18} />
                      Your personal space
                    </h3>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      void action(async () => {
                        await commit({
                          ...config,
                          user_name:
                            String(form.get("name")).trim().slice(0, 30) ||
                            "there",
                          daily_goal: Number(form.get("goal")),
                        });
                        notify("Your preferences are saved.");
                      });
                    }}
                  >
                    <label className="form-field">
                      What should we call you?
                      <input
                        key={config.user_name}
                        name="name"
                        placeholder="Your first name"
                        defaultValue={
                          config.user_name === "there" ? "" : config.user_name
                        }
                        maxLength={30}
                      />
                    </label>
                    <label className="form-field">
                      Daily focus goal
                      <div className="input-with-unit">
                        <input
                          key={config.daily_goal}
                          name="goal"
                          type="number"
                          min={15}
                          max={1440}
                          defaultValue={config.daily_goal}
                          required
                        />
                        <span>minutes</span>
                      </div>
                    </label>
                    <button
                      disabled={busy}
                      className="button secondary"
                      type="submit"
                    >
                      Save preferences
                      <Check size={14} />
                    </button>
                  </form>
                </section>
                <section className="card privacy-card">
                  <ShieldCheck size={24} />
                  <h3>Your time is yours.</h3>
                  <p>
                    Works completely offline. Timers, schedules, app blocking,
                    website rules, and history stay on this device. No account,
                    tracking, cloud connection, or internet access required.
                  </p>
                  <span>
                    Made with Rust. Built for focus.
                    <span className="color-dot mint" />
                  </span>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
      {editingGroup && (
        <GroupEditor
          group={editingGroup}
          existing={config.groups.some((g) => g.id === editingGroup.id)}
          close={() => setEditingGroup(null)}
          notify={notify}
          save={async (group) => {
            await commit({
              ...config,
              groups: config.groups.some((g) => g.id === group.id)
                ? config.groups.map((g) => (g.id === group.id ? group : g))
                : [...config.groups, group],
            });
            setEditingGroup(null);
            notify("Block list saved. A little less distraction.");
          }}
          remove={async () => {
            if (active?.group_ids.includes(editingGroup.id))
              throw new Error(
                "End the current session before deleting this list.",
              );
            await commit({
              ...config,
              groups: config.groups.filter((g) => g.id !== editingGroup.id),
              schedules: config.schedules
                .map((s) => ({
                  ...s,
                  group_ids: s.group_ids.filter((g) => g !== editingGroup.id),
                }))
                .filter((s) => s.group_ids.length > 0),
            });
            setSelected((s) => s.filter((g) => g !== editingGroup.id));
            setEditingGroup(null);
            notify("Block list deleted.");
          }}
        />
      )}
      {editingSchedule && (
        <ScheduleEditor
          schedule={editingSchedule}
          groups={config.groups}
          existing={config.schedules.some((s) => s.id === editingSchedule.id)}
          close={() => setEditingSchedule(null)}
          save={async (s) => {
            if (native && s.enabled && !engineReady) await enableEngine();
            await commit({
              ...config,
              schedules: config.schedules.some((item) => item.id === s.id)
                ? config.schedules.map((item) => (item.id === s.id ? s : item))
                : [...config.schedules, s],
            });
            setEditingSchedule(null);
            await refresh();
            notify(
              native
                ? "Your routine is ready. Schedule saved."
                : "Schedule saved in preview. Run the desktop app for automatic blocking.",
            );
          }}
          remove={async () => {
            await commit({
              ...config,
              schedules: config.schedules.filter(
                (s) => s.id !== editingSchedule.id,
              ),
            });
            setEditingSchedule(null);
            notify("Schedule deleted.");
          }}
        />
      )}
      {startModal && (
        <Modal
          title={
            active
              ? "Your session is running"
              : native
                ? "Make a little room."
                : "Try a focus session."
          }
          subtitle={
            native
              ? "Choose your time. We’ll handle the distractions."
              : "This preview runs a timer. Websites and apps stay accessible."
          }
          close={() => {
            if (!busy) setStartModal(false);
          }}
        >
          <label className="form-field">
            Focus duration
            <div className="input-with-unit">
              <input
                type="number"
                autoFocus
                min={1}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
              <span>minutes</span>
            </div>
          </label>
          <label className="form-label">Block lists</label>
          <div className="select-group-list">
            {config.groups.map((g) => (
              <button
                className={selected.includes(g.id) ? "selected" : ""}
                key={g.id}
                onClick={() =>
                  setSelected((ids) =>
                    ids.includes(g.id)
                      ? ids.filter((x) => x !== g.id)
                      : [...ids, g.id],
                  )
                }
              >
                <GroupIcon group={g} small />
                <span>
                  {g.name}
                  <small>
                    {g.domains.length} websites · {g.apps.length} apps
                  </small>
                </span>
                <span className="checkbox">
                  {selected.includes(g.id) && <Check size={13} />}
                </span>
              </button>
            ))}
          </div>
          {native && (
            <div className="inline-note">
              <AlertCircle size={16} />
              <p>
                Save your work first. Selected apps will close during the
                session.
                {!engineReady
                  ? " Your OS will ask for administrator permission to enable website blocking."
                  : ""}
              </p>
            </div>
          )}
          {native && data.platform === "macos" && (
            <div className="inline-note">
              <Globe size={16} />
              <p>
                {config.safari_protection
                  ? "Safari protection is enabled. Blocked tabs switch to an offline focus page."
                  : "Using Safari? Enable Safari protection in Settings before starting to cover cached pages and connections."}
              </p>
            </div>
          )}
          {native &&
            data.platform === "windows" &&
            (!data.browser?.connected || !!data.browser.error) && (
              <div className="inline-note">
                <Globe size={16} />
                <div>
                  <p>
                    Chrome and Edge can reuse existing connections. Set up
                    browser protection to cover those tabs during this session.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setStartModal(false);
                      go("Settings");
                    }}
                  >
                    Set up browser protection <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}
          {startError && (
            <div className="form-error" role="alert">
              <AlertCircle size={16} />
              <span>{startError}</span>
            </div>
          )}
          {busy && (
            <p className="startup-status" role="status">
              {native
                ? "Starting the local blocking engine and confirming your rules. Complete your macOS or Windows permission prompt if it appears."
                : "Starting your timer…"}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setStartModal(false)}
              disabled={busy}
            >
              Not now
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !!active ||
                !selected.length ||
                duration < 1 ||
                duration > 1440 ||
                !Number.isInteger(duration)
              }
              onClick={() => void begin()}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
              {busy
                ? "Starting session…"
                : native
                  ? "Start focus session"
                  : "Start preview timer"}
            </button>
          </div>
        </Modal>
      )}
      {stopModal && (
        <Modal
          title="Ready to wrap up?"
          subtitle="Every minute you made for yourself counts."
          close={() => setStopModal(false)}
        >
          <div className="inline-note">
            <Coffee size={21} />
            <p>
              Ending this timer releases its block lists. Any currently running
              schedules will keep their own lists blocked.
            </p>
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setStopModal(false)}
            >
              Keep focusing
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const next = await stopSession();
                  setData({ ...data, config: next });
                  setStopModal(false);
                  notify("Session ended. A little progress is still progress.");
                })
              }
            >
              End session
            </button>
          </div>
        </Modal>
      )}
      {searchOpen && (
        <SearchModal
          groups={config.groups}
          close={() => setSearchOpen(false)}
          navigate={(p) => {
            go(p);
            setSearchOpen(false);
          }}
          edit={(g) => {
            setEditingGroup(structuredClone(g));
            setSearchOpen(false);
          }}
        />
      )}
      {help && (
        <Modal
          title="A little help finding focus."
          subtitle="Your quick guide to Arceo."
          close={() => setHelp(false)}
        >
          <div className="help-steps">
            {[
              {
                icon: Shield,
                title: "1. Choose your distractions",
                text: "Use a preset block list or create your own. Add domains and pick installed desktop applications.",
              },
              {
                icon: Timer,
                title: "2. Make time for what matters",
                text: "Start a timed focus session, or create a repeating schedule for the days and times that work for you.",
              },
              {
                icon: Monitor,
                title: "3. Let the desktop app handle it",
                text: "The Rust engine needs administrator permission for website rules. It runs in the background until disabled or your computer restarts.",
              },
            ].map((s) => (
              <div key={s.title}>
                <span className="group-icon purple">
                  <s.icon size={19} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
          {!native && (
            <div className="inline-note">
              <Globe size={19} />
              <p>
                This is the browser preview. To launch native blocking, run{" "}
                <code>npm run tauri dev</code> in the project folder. Preview
                data stays separate from desktop data.
              </p>
            </div>
          )}
          <div className="modal-actions">
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it
              <Check size={14} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          {toast.error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ArceoLogo() {
  return (
    <svg
      className="arceo-logo"
      width="32"
      height="32"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="12" fill="#B39AF8" />
      <path d="M9.5 28 20 10l10.5 18h-7l-3.5-6.5L16.5 28h-7Z" fill="#1E172E" />
    </svg>
  );
}
function Stat({
  icon: Icon,
  color,
  label,
  value,
  detail,
  progress,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <section className="stat-card card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">
        {progress !== undefined ? (
          <>
            <div className="stat-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
            {detail}
          </>
        ) : (
          <>
            <span className={`color-dot ${color}`} />
            {detail}
          </>
        )}
      </div>
    </section>
  );
}
function GroupCard({
  group: g,
  active,
  edit,
  activate,
}: {
  group: Group;
  active: boolean;
  edit: () => void;
  activate: () => void;
}) {
  return (
    <article className={`card group-card ${g.color}`}>
      <div className="group-card-top">
        <GroupIcon group={g} />
        <button
          className="icon-button"
          onClick={edit}
          aria-label={`Edit ${g.name}`}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <button className="group-title" onClick={edit}>
        <h3>{g.name}</h3>
        <p>{g.description}</p>
      </button>
      <div className="group-counts">
        <span>
          <Globe size={12} />
          {g.domains.length} websites
        </span>
        <span>
          <Monitor size={12} />
          {g.apps.length} apps
        </span>
      </div>
      <div className="group-card-footer">
        <div className="site-stack">
          {g.domains.slice(0, 3).map((d, i) => (
            <span title={d} key={d} className={`site-monogram site-${i}`}>
              {d === "youtube.com" ? (
                <Play size={11} fill="currentColor" />
              ) : d === "x.com" ? (
                "𝕏"
              ) : d === "instagram.com" ? (
                "◎"
              ) : d === "store.steampowered.com" ? (
                "♧"
              ) : d === "facebook.com" ? (
                "f"
              ) : d === "netflix.com" ? (
                "N"
              ) : d === "amazon.com" ? (
                "a"
              ) : (
                d.slice(0, 1)
              )}
            </span>
          ))}
          {g.domains.length > 3 && (
            <span className="site-extra">+{g.domains.length - 3}</span>
          )}
          {g.domains.length === 0 && (
            <span className="no-sites">Your own little list</span>
          )}
        </div>
        <button
          className={`activate-button ${active ? "active" : ""}`}
          onClick={active ? edit : activate}
        >
          {active ? (
            <>
              <span className="color-dot mint" />
              In session
            </>
          ) : (
            <>
              Activate
              <ArrowUpRight size={12} />
            </>
          )}
        </button>
      </div>
    </article>
  );
}

function GroupEditor({
  group,
  existing,
  close,
  save,
  remove,
  notify,
}: {
  group: Group;
  existing: boolean;
  close: () => void;
  save: (g: Group) => Promise<void>;
  remove: () => Promise<void>;
  notify: (s: string, error?: boolean) => void;
}) {
  const [draft, setDraft] = useState(group),
    [tab, setTab] = useState("Websites"),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [apps, setApps] = useState<AppTarget[]>([]),
    [loadingApps, setLoadingApps] = useState(false),
    [appSearch, setAppSearch] = useState(""),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (tab === "Desktop apps" && native) {
      setLoadingApps(true);
      invoke<AppTarget[]>("list_apps")
        .then(setApps)
        .catch((e) => setError(errorText(e)))
        .finally(() => setLoadingApps(false));
    }
  }, [tab]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function addDomain() {
    try {
      const normalized = domain(input);
      if (draft.domains.includes(normalized)) {
        setError("That website is already in this list.");
        return;
      }
      setDraft({ ...draft, domains: [...draft.domains, normalized] });
      setInput("");
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  const addApp = (app: AppTarget) =>
    setDraft((g) => ({
      ...g,
      apps: g.apps.some((a) => a.path === app.path) ? g.apps : [...g.apps, app],
    }));
  return (
    <Modal
      wide
      title={
        existing ? "A little less distraction." : "Make a list of your own."
      }
      subtitle="Choose what stays out of your focus time."
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="group-edit-heading">
        <GroupIcon group={draft} />
        <label className="form-field">
          List name
          <input
            autoFocus
            value={draft.name}
            placeholder="e.g. Social media"
            maxLength={60}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="color-picker">
          {["purple", "coral", "blue", "mint", "amber"].map((c) => (
            <button
              aria-label={`${c} list color`}
              key={c}
              className={`color-dot ${c} ${draft.color === c ? "chosen" : ""}`}
              onClick={() => setDraft({ ...draft, color: c })}
            >
              {draft.color === c && <Check size={11} />}
            </button>
          ))}
        </div>
      </div>
      <label className="form-field">
        A little description
        <input
          value={draft.description}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <div className="tabs editor-tabs">
        {["Websites", "Desktop apps"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "Websites" ? <Globe size={14} /> : <Monitor size={14} />} {t}
            <span>
              {t === "Websites" ? draft.domains.length : draft.apps.length}
            </span>
          </button>
        ))}
      </div>
      {tab === "Websites" ? (
        <>
          <form
            className="add-domain"
            onSubmit={(e) => {
              e.preventDefault();
              addDomain();
            }}
          >
            <div className="input-icon">
              <Globe size={16} />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Add a website, like reddit.com"
              />
            </div>
            <button
              className="button secondary"
              disabled={!input.trim()}
              type="submit"
            >
              <Plus size={15} />
              Add
            </button>
          </form>
          <div className="domain-list">
            {draft.domains.length ? (
              draft.domains.map((d) => (
                <div key={d}>
                  <span className="domain-letter">
                    {d.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{d}</span>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${d}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        domains: draft.domains.filter((item) => item !== d),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            ) : (
              <Empty icon={Globe} title="A clean slate.">
                <p>Add a website you’d like to spend a little less time on.</p>
              </Empty>
            )}
          </div>
          <p className="fine-print">
            Includes the domain and www. Add other subdomains separately, like
            m.youtube.com. Blocks apply to the entire domain, rather than
            individual pages.
          </p>
        </>
      ) : (
        <>
          <div className="app-selected-list">
            {draft.apps.map((a) => (
              <div key={a.id}>
                <Monitor size={16} />
                <span>
                  {a.name}
                  <small>{a.path}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      apps: draft.apps.filter((item) => item.id !== a.id),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          {native ? (
            <>
              <label className="search-field app-search">
                <Search size={15} />
                <input
                  placeholder="Find an installed or running app…"
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                />
              </label>
              <div className="app-picker">
                {loadingApps ? (
                  <div className="loading-apps">
                    <LoaderCircle className="spin" size={20} />
                    Finding apps on your device…
                  </div>
                ) : (
                  apps
                    .filter((a) =>
                      a.name.toLowerCase().includes(appSearch.toLowerCase()),
                    )
                    .map((a) => (
                      <button
                        key={a.path}
                        disabled={draft.apps.some(
                          (item) => item.path === a.path,
                        )}
                        onClick={() => addApp(a)}
                      >
                        <span className="app-letter">{a.name.slice(0, 1)}</span>
                        <span>{a.name}</span>
                        {draft.apps.some((item) => item.path === a.path) ? (
                          <Check size={15} />
                        ) : (
                          <Plus size={15} />
                        )}
                      </button>
                    ))
                )}
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  void perform(async () => {
                    const path = await open({
                      multiple: false,
                      directory: false,
                      ...(navigator.platform.startsWith("Win")
                        ? {
                            filters: [
                              { name: "Application", extensions: ["exe"] },
                            ],
                          }
                        : {}),
                    });
                    if (typeof path === "string")
                      addApp(await invoke<AppTarget>("resolve_app", { path }));
                  })
                }
              >
                <FolderPlus size={15} />
                Browse for an application
              </button>
            </>
          ) : (
            <div className="settings-callout">
              <Monitor size={23} />
              <div>
                <strong>Pick apps in the desktop version.</strong>
                <p>
                  The Rust app discovers your installed applications and lets
                  you choose any .app or .exe. Your browser can’t access desktop
                  processes.
                </p>
              </div>
            </div>
          )}
          <div className="inline-note">
            <AlertCircle size={15} />
            <p>
              Selected apps will close when blocking begins. Save any open work
              before starting a session.
            </p>
          </div>
        </>
      )}
      {error && (
        <div className="form-error" role="alert">
          <AlertCircle size={15} />
          {error}
        </div>
      )}
      {deleting && (
        <div className="delete-confirm">
          <p>
            Delete this list? It will also be removed from schedules. Schedules
            with no remaining lists will be deleted.
          </p>
          <button
            className="text-button danger"
            onClick={() => void perform(remove)}
            disabled={busy}
          >
            Yes, delete list
          </button>
          <button className="text-button" onClick={() => setDeleting(false)}>
            Keep it
          </button>
        </div>
      )}
      <div className="modal-actions">
        {existing && (
          <button
            className="icon-button delete-button"
            aria-label="Delete block list"
            onClick={() => setDeleting(true)}
            disabled={busy}
          >
            <Trash2 size={17} />
          </button>
        )}
        <button className="button secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy || !draft.name.trim()}
          onClick={() =>
            void perform(async () => {
              if (!draft.domains.length && !draft.apps.length)
                notify(
                  "This list is empty. Add websites or apps when you’re ready.",
                );
              await save(draft);
            })
          }
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}
          Save block list
        </button>
      </div>
    </Modal>
  );
}
function ScheduleEditor({
  schedule,
  groups,
  existing,
  close,
  save,
  remove,
}: {
  schedule: Schedule;
  groups: Group[];
  existing: boolean;
  close: () => void;
  save: (s: Schedule) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(schedule),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        existing ? "A routine that works for you." : "Put your focus on repeat."
      }
      subtitle="A little structure. A lot more space."
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(() => save(draft));
        }}
      >
        <label className="form-field">
          Schedule name
          <input
            autoFocus
            required
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Morning deep work"
          />
        </label>
        <div className="time-inputs">
          <label className="form-field">
            From
            <input
              required
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <ArrowRight size={17} />
          <label className="form-field">
            Until
            <input
              required
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
        </div>
        {draft.end < draft.start && (
          <p className="fine-print">
            Ends the following day. The days below refer to when the block
            starts.
          </p>
        )}
        <label className="form-label">Repeat on</label>
        <div className="day-picker">
          {dayLabels.map((d, i) => (
            <button
              type="button"
              key={d}
              aria-pressed={draft.days.includes(i)}
              className={draft.days.includes(i) ? "selected" : ""}
              onClick={() =>
                setDraft({
                  ...draft,
                  days: draft.days.includes(i)
                    ? draft.days.filter((day) => day !== i)
                    : [...draft.days, i].sort(),
                })
              }
            >
              {d}
            </button>
          ))}
        </div>
        <label className="form-label">Block these lists</label>
        <div className="select-group-list schedule-group-picker">
          {groups.map((g) => (
            <button
              type="button"
              key={g.id}
              className={draft.group_ids.includes(g.id) ? "selected" : ""}
              onClick={() =>
                setDraft({
                  ...draft,
                  group_ids: draft.group_ids.includes(g.id)
                    ? draft.group_ids.filter((item) => item !== g.id)
                    : [...draft.group_ids, g.id],
                })
              }
            >
              <GroupIcon group={g} small />
              <span>{g.name}</span>
              <span className="checkbox">
                {draft.group_ids.includes(g.id) && <Check size={13} />}
              </span>
            </button>
          ))}
        </div>
        <div className="schedule-enabled">
          <div>
            <strong>Enable this schedule</strong>
            <p>
              {Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone.replace(/_/g, " ")}{" "}
              · follows local time
            </p>
          </div>
          <Toggle
            checked={draft.enabled}
            label="Enable schedule"
            onChange={() => setDraft({ ...draft, enabled: !draft.enabled })}
          />
        </div>
        {native && draft.enabled && (
          <p className="fine-print">
            Saving enables the background engine if needed. Selected apps close
            automatically when this schedule runs.
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={15} />
            {error}
          </div>
        )}
        {deleting && (
          <div className="delete-confirm">
            <p>Delete this schedule?</p>
            <button
              type="button"
              className="text-button danger"
              onClick={() => void perform(remove)}
              disabled={busy}
            >
              Yes, delete schedule
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setDeleting(false)}
            >
              Keep it
            </button>
          </div>
        )}
        <div className="modal-actions">
          {existing && (
            <button
              type="button"
              className="icon-button delete-button"
              aria-label="Delete schedule"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              busy ||
              !draft.name.trim() ||
              !draft.days.length ||
              !draft.group_ids.length ||
              !draft.start ||
              !draft.end ||
              draft.start === draft.end
            }
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            Save schedule
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SearchModal({
  groups,
  close,
  navigate,
  edit,
}: {
  groups: Group[];
  close: () => void;
  navigate: (p: Page) => void;
  edit: (g: Group) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <Modal title="Find your space." close={close}>
      <label className="search-field command-search">
        <Search size={18} />
        <input
          autoFocus
          placeholder="Search pages and block lists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>esc</kbd>
      </label>
      <div className="command-results">
        {[...nav, { name: "Settings" as Page, icon: Settings2 }]
          .filter((n) => n.name.toLowerCase().includes(query.toLowerCase()))
          .map(({ name, icon: Icon }) => (
            <button key={name} onClick={() => navigate(name)}>
              <Icon size={17} />
              <span>{name}</span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        {groups
          .filter((g) =>
            (g.name + " " + g.domains.join(" "))
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((g) => (
            <button key={g.id} onClick={() => edit(g)}>
              <GroupIcon group={g} small />
              <span>{g.name}</span>
              <span className="muted">Block list</span>
            </button>
          ))}
      </div>
    </Modal>
  );
}

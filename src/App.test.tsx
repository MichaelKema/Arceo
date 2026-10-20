// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import defaults from "./defaults.json";
import type { Config } from "./types";
import App from "./App";
import { enableEngine, startSession, snapshot } from "./lib";
vi.mock("./lib", async (original) => ({
  ...(await original<typeof import("./lib")>()),
  native: true,
  snapshot: vi.fn(),
  enableEngine: vi.fn(),
  startSession: vi.fn(),
}));
function state(config: Config = structuredClone(defaults) as Config) {
  return {
    config,
    platform: "macos",
    runtime: {
      online: false,
      heartbeat: 0,
      blocked_domains: 0,
      blocked_apps: 0,
      active_schedule_ids: [],
      error: null,
    },
  };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(snapshot).mockResolvedValue(state());
  vi.mocked(enableEngine).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function openStart() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", {
      name: "Start focus session",
    }),
  );
  const dialog = screen.getByRole("dialog");
  return {
    user,
    dialog,
    start: within(dialog).getByRole("button", {
      name: "Start focus session",
    }),
  };
}
describe("focus session startup", () => {
  it("shows engine failures inside the open dialog and lets the user retry", async () => {
    vi.mocked(enableEngine).mockRejectedValue(
      new Error("Administrator approval was canceled."),
    );
    const { user, dialog, start } = await openStart();
    await user.click(start);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Administrator approval was canceled.",
    );
    expect(start.hasAttribute("disabled")).toBe(false);
    expect(startSession).not.toHaveBeenCalled();
    vi.mocked(enableEngine).mockResolvedValue(undefined);
    vi.mocked(startSession).mockRejectedValue(
      new Error("The engine lost its connection."),
    );
    await user.click(start);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "The engine lost its connection.",
    );
  });
  it("waits for permission, then starts one session and displays the countdown", async () => {
    let allow!: () => void;
    vi.mocked(enableEngine).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
    );
    const { user, dialog, start } = await openStart();
    const config = structuredClone(defaults) as Config;
    const now = Math.floor(Date.now() / 1000);
    config.active_session = {
      id: "session",
      name: "Deep work",
      group_ids: ["social", "entertainment"],
      started_at: now,
      ends_at: now + 45 * 60,
      ended_at: null,
    };
    vi.mocked(startSession).mockImplementation(async () => {
      vi.mocked(snapshot).mockResolvedValue({
        ...state(config),
        runtime: { ...state().runtime, online: true },
      });
      return config;
    });
    await user.click(start);
    expect(
      within(dialog)
        .getByRole("button", { name: "Starting session…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(within(dialog).getByRole("status").textContent).toContain(
      "permission prompt",
    );
    expect(startSession).not.toHaveBeenCalled();
    allow();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(startSession).toHaveBeenCalledExactlyOnceWith(
      45,
      ["social", "entertainment"],
      "Deep work",
    );
    expect(screen.getByRole("button", { name: "End session" })).toBeTruthy();
    expect(screen.getByText("TIME REMAINING")).toBeTruthy();
  });
});

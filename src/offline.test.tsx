// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { snapshot, startSession } from "./lib";

let attempts: string[];
beforeEach(() => {
  localStorage.clear();
  attempts = [];
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", () => {
    attempts.push("fetch");
    throw new Error("No network");
  });
  for (const api of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    vi.stubGlobal(
      api,
      class {
        constructor() {
          attempts.push(api);
          throw new Error("No network");
        }
      },
    );
  }
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline functionality", () => {
  it("edits lists, saves schedules, runs timers, and restores history with all network APIs unavailable", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "New block list" }),
    );
    let dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "List name" }),
      "Offline list",
    );
    await user.type(
      within(dialog).getByPlaceholderText("Add a website, like reddit.com"),
      "offline.example",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Save block list" }),
    );
    await user.click(screen.getByRole("button", { name: "Schedules" }));
    await user.click(screen.getByRole("button", { name: "New schedule" }));
    dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Schedule name" }),
      "Offline routine",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Offline list" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save schedule" }),
    );
    await user.click(screen.getByRole("button", { name: "Overview" }));
    await user.click(
      screen.getByRole("button", { name: "Start focus session" }),
    );
    dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Start preview timer" }),
    );
    expect(await screen.findByText("TIME REMAINING")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "End session",
      }),
    );
    view.unmount();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Insights" }));
    expect(await screen.findByText("Ended early")).toBeTruthy();
    const saved = await snapshot();
    const list = saved.config.groups.find((g) => g.name === "Offline list")!;
    expect(list.domains).toEqual(["offline.example"]);
    expect(saved.config.schedules[0].name).toBe("Offline routine");
    expect(saved.config.schedules[0].group_ids).toContain(list.id);
    expect(saved.config.sessions).toHaveLength(1);
    expect(attempts).toEqual([]);
  });
  it("restores a running timer and expires it using only the local clock", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-10-20T16:00:00-04:00");
    vi.setSystemTime(start);
    const initial = await startSession(2, ["social"], "Offline focus");
    vi.setSystemTime(start.getTime() + 61_000);
    const resumed = await snapshot();
    expect(resumed.config.active_session?.ends_at).toBe(
      initial.active_session?.ends_at,
    );
    expect(
      resumed.config.active_session!.ends_at - Math.floor(Date.now() / 1000),
    ).toBe(59);
    vi.setSystemTime(start.getTime() + 121_000);
    const expired = await snapshot();
    expect(expired.config.active_session).toBe(null);
    expect(expired.config.sessions[0].name).toBe("Offline focus");
    expect(attempts).toEqual([]);
  });
});

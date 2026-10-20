import { describe, it, expect } from "vitest";
import { domain, scheduleActive, nextOccurrence, dailyMinutes } from "./lib";
import type { Schedule, Session } from "./types";
const schedule: Schedule = {
  id: "night",
  name: "Night",
  group_ids: ["social"],
  days: [0],
  start: "22:00",
  end: "02:00",
  enabled: true,
};
describe("website rules", () => {
  it("normalizes URLs while rejecting local addresses and credentials", () => {
    expect(domain("https://www.Reddit.com/r/rust")).toBe("reddit.com");
    for (const input of [
      "localhost",
      "127.0.0.1",
      "https://user:pass@reddit.com",
      "reddit.com:9999",
      "file:///etc/hosts",
      "foo..com",
    ])
      expect(() => domain(input), input).toThrow();
  });
});
describe("local scheduling", () => {
  it("keeps an overnight Monday block active on Tuesday, until the exact end", () => {
    expect(scheduleActive(schedule, new Date(2026, 9, 19, 22, 0))).toBe(true);
    expect(scheduleActive(schedule, new Date(2026, 9, 20, 1, 59))).toBe(true);
    expect(scheduleActive(schedule, new Date(2026, 9, 20, 2, 0))).toBe(false);
    expect(scheduleActive(schedule, new Date(2026, 9, 20, 22, 0))).toBe(false);
  });
  it("finds the next enabled occurrence without skipping the following week", () => {
    expect(nextOccurrence(schedule, new Date(2026, 9, 19, 23))?.getDate()).toBe(
      26,
    );
    expect(nextOccurrence({ ...schedule, enabled: false })).toBe(null);
  });
});
describe("focus accounting", () => {
  it("splits cross-midnight sessions between days and caps an early stop", () => {
    const begin = new Date(2026, 9, 19, 23, 30).getTime() / 1000;
    const session: Session = {
      id: "s",
      name: "Focus",
      group_ids: ["social"],
      started_at: begin,
      ends_at: begin + 7200,
      ended_at: begin + 3600,
    };
    expect(dailyMinutes([session], new Date(2026, 9, 19), begin + 7200)).toBe(
      30,
    );
    expect(dailyMinutes([session], new Date(2026, 9, 20), begin + 7200)).toBe(
      30,
    );
  });
});

import { describe, it, expect } from "vitest";
import { blockedHost, sessionRules } from "./policy.js";
describe("Chrome website policy", () => {
  it("matches X, www, subdomains and cached-tab URLs without blocking lookalikes", () => {
    for (const url of [
      "https://x.com/home",
      "https://www.x.com",
      "https://api.x.com",
      "https://X.COM./",
      "http://x.com:8080",
    ])
      expect(blockedHost(url, ["x.com"])).toBeTruthy();
    for (const url of [
      "https://notx.com",
      "https://x.com.evil.example",
      "https://x.com@safe.example",
      "chrome://extensions",
      "data:text/html,x.com",
    ])
      expect(blockedHost(url, ["x.com"])).toBeNull();
  });
  it("blocks requests through the browser with session rules and removes all rules at expiry", () => {
    const rules = sessionRules(["x.com", "twitter.com"]);
    expect(rules).toHaveLength(2);
    expect(rules[0].condition.resourceTypes).toEqual(["main_frame"]);
    expect(rules[1].condition.resourceTypes).toBeUndefined();
    expect(rules.map((rule) => rule.id)).toEqual([1, 2]);
    expect(
      rules.every(
        (rule) =>
          rule.action.type === "block" &&
          rule.condition.requestDomains.includes("x.com"),
      ),
    ).toBe(true);
    expect(sessionRules([])).toEqual([]);
    expect(() => sessionRules(["https://x.com"])).toThrow();
  });
});

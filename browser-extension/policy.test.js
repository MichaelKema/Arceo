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
    expect(sessionRules(["x.com", "twitter.com"])).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: ["x.com", "twitter.com"],
          excludedResourceTypes: [],
        },
      },
    ]);
    expect(sessionRules([])).toEqual([]);
    expect(() => sessionRules(["https://x.com"])).toThrow();
  });
});

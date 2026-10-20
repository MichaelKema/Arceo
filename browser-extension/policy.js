export function blockedHost(address, domains) {
  try {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
      ? host
      : null;
  } catch {
    return null;
  }
}
export function sessionRules(domains) {
  if (
    !Array.isArray(domains) ||
    domains.some(
      (d) => typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d),
    )
  )
    throw new Error("Invalid Arceo website rules");
  const rules = [];
  for (let offset = 0; offset < domains.length; offset += 1000) {
    rules.push({
      id: rules.length + 1,
      priority: 1,
      action: { type: "block" },
      // Omitting both resource-type fields excludes main-frame navigations.
      // An explicit empty exclusion list blocks every type, including pages.
      condition: {
        requestDomains: domains.slice(offset, offset + 1000),
        excludedResourceTypes: [],
      },
    });
  }
  return rules;
}

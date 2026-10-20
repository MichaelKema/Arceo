import { readFile, access } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Audit the shipped asset graph: a clean installation must not rely on a
// browser cache, dev server, CDN, remotely hosted font, or online bootstrapper.
const root = path.resolve("dist");
const visited = new Set();
async function visit(reference, from = path.join(root, "index.html")) {
  if (reference.startsWith("data:") || reference.startsWith("#")) return;
  assert(
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference),
    `Remote asset: ${reference}`,
  );
  const filename = reference.startsWith("/")
    ? path.join(root, reference)
    : path.resolve(path.dirname(from), reference.split(/[?#]/)[0]);
  assert(
    filename === root || filename.startsWith(root + path.sep),
    `Asset outside bundle: ${reference}`,
  );
  if (visited.has(filename)) return;
  await access(filename);
  visited.add(filename);
  if (filename.endsWith(".html")) {
    const html = await readFile(filename, "utf8");
    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g))
      await visit(match[1], filename);
  } else if (filename.endsWith(".css")) {
    const css = await readFile(filename, "utf8");
    assert(!/@import\b/.test(css), "Unbundled CSS import");
    for (const match of css.matchAll(
      /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g,
    ))
      await visit(match[1] || match[2] || match[3], filename);
  }
}
await visit("index.html");
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
assert.equal(
  config.build.frontendDist,
  "../dist",
  "Release must embed its frontend",
);
assert.equal(
  config.bundle.windows.webviewInstallMode.type,
  "offlineInstaller",
  "Windows setup must include the full offline WebView2 installer",
);
const connect = config.app.security.csp
  .split(";")
  .map((s) => s.trim())
  .find((s) => s.startsWith("connect-src "));
assert.equal(
  connect,
  "connect-src ipc: http://ipc.localhost",
  "Release may connect only to native IPC",
);
console.log(
  `Offline bundle verified: ${visited.size} local assets, local-only IPC, offline Windows runtime installer.`,
);

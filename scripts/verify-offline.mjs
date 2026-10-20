import { readFile, access } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
const extension = JSON.parse(
  await readFile("browser-extension/manifest.json", "utf8"),
);
assert.equal(extension.version, config.version);
assert.deepEqual(extension.permissions.slice().sort(), [
  "declarativeNetRequest",
  "nativeMessaging",
  "tabs",
]);
assert.equal(
  extension.host_permissions,
  undefined,
  "Browser protection must not request page contents",
);
assert(
  extension.content_security_policy.extension_pages.includes(
    "connect-src 'none'",
  ),
);
const identity = createHash("sha256")
  .update(Buffer.from(extension.key, "base64"))
  .digest("hex")
  .slice(0, 32)
  .split("")
  .map((n) => String.fromCharCode(97 + parseInt(n, 16)))
  .join("");
assert.equal(
  identity,
  (await readFile("browser-extension/extension-id.txt", "utf8")).trim(),
);
const embedding = await readFile("src-tauri/src/browser.rs", "utf8");
for (const file of [
  "manifest.json",
  "background.js",
  "policy.js",
  "blocked.html",
  "blocked.js",
  "style.css",
  "popup.html",
  "popup.js",
]) {
  const contents = await readFile(`browser-extension/${file}`, "utf8");
  assert(
    embedding.includes(`browser-extension/${file}`),
    `Browser asset must be embedded: ${file}`,
  );
  assert(
    !/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(contents),
    `Browser asset must not use network APIs: ${file}`,
  );
}
console.log(
  `Offline bundle verified: ${visited.size} local assets, local-only IPC, embedded browser companion, offline Windows runtime installer.`,
);

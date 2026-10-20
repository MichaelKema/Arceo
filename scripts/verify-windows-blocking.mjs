// Runs only on a disposable Windows CI runner, never on the developer's Mac.
// All browser traffic goes to a local fixture; no website or external DNS is needed.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { readFile, writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "win32", "Use the disposable Windows CI runner");
assert.equal(
  process.env.CI,
  "true",
  "This test temporarily edits the CI machine's hosts file",
);
const binary = resolve(process.argv[2] || "src-tauri/target/release/arceo.exe");
await access(binary);
const hosts = join(process.env.SystemRoot, "System32/drivers/etc/hosts");
const ipconfig = join(process.env.SystemRoot, "System32/ipconfig.exe");
const original = await readFile(hosts);
assert(
  !original.includes(Buffer.from("# BEGIN ARCEO MANAGED BLOCK")),
  "Runner already has active Arceo rules",
);
const temp = await mkdtemp(join(tmpdir(), "arceo-web-regression-"));
const configPath = join(temp, "config.json");
const children = [];
const sockets = [];
const key = join(temp, "fixture.key");
const cert = join(temp, "fixture.pem");
const openssl = join(process.env.ProgramFiles, "Git/usr/bin/openssl.exe");
execFileSync(
  openssl,
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=x.com",
  ],
  { stdio: "ignore", windowsHide: true },
);
const fixture = createServer(
  { key: await readFile(key), cert: await readFile(cert) },
  (_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    response.end(
      "<!doctype html><title>Arceo fixture</title><p>ARCEO_LOCAL_FIXTURE</p>",
    );
  },
);
fixture.keepAliveTimeout = 120_000;
fixture.on("connection", (socket) => sockets.push(socket));

async function until(read, message, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value) return value;
    } catch {
      /* pending */
    }
    await delay(100);
  }
  throw new Error(message);
}
async function chrome(profile) {
  const candidates = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]
    .filter(Boolean)
    .map((dir) => join(dir, "Google/Chrome/Application/chrome.exe"));
  let executable;
  for (const path of candidates) {
    try {
      await access(path);
      executable = path;
      break;
    } catch {
      /* next */
    }
  }
  assert(executable, "Chrome must be installed on the Windows runner");
  const directory = join(temp, profile);
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-proxy-server",
      "--ignore-certificate-errors", // only this disposable profile and local test certificate
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${directory}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  children.push(child);
  const port = await until(
    async () =>
      (await readFile(join(directory, "DevToolsActivePort"), "utf8")).split(
        "\n",
      )[0],
    "Chrome debugging port did not start",
  );
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const ws = new WebSocket(
    pages.find((p) => p.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((yes, no) => {
    ws.addEventListener("open", yes, { once: true });
    ws.addEventListener("error", no, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    if (value.id && pending.has(value.id)) {
      pending.get(value.id)(value);
      pending.delete(value.id);
    }
  });
  const call = (method, params = {}) =>
    new Promise((yes, no) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        no(new Error(`Chrome ${method} timed out`));
      }, 15_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        value.error
          ? no(new Error(JSON.stringify(value.error)))
          : yes(value.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await call("Page.enable");
  return { call, ws };
}

let engine;
try {
  await new Promise((yes, no) => {
    fixture.once("error", no);
    fixture.listen(0, "127.0.0.2", yes);
  });
  const url = `https://x.com:${fixture.address().port}`;
  // A marked fixture mapping is replaced by the production helper, so it does
  // not create an unrelated duplicate hosts entry that could itself bypass rules.
  await writeFile(
    hosts,
    Buffer.concat([
      original,
      Buffer.from(
        "\r\n# BEGIN ARCEO MANAGED BLOCK\r\n127.0.0.2 x.com\r\n::1 x.com\r\n# END ARCEO MANAGED BLOCK\r\n",
      ),
    ]),
  );
  execFileSync(ipconfig, ["/flushdns"], { windowsHide: true });
  const warm = await chrome("already-open-chrome");
  await warm.call("Page.navigate", { url: `${url}/before` });
  await until(
    async () =>
      (
        await warm.call("Runtime.evaluate", {
          expression: "document.body?.textContent || ''",
          returnByValue: true,
        })
      ).result.value.includes("ARCEO_LOCAL_FIXTURE"),
    "Local fixture did not load before blocking",
  );
  const config = JSON.parse(
    await readFile(new URL("../src/defaults.json", import.meta.url), "utf8"),
  );
  const now = Math.floor(Date.now() / 1000);
  config.groups = [
    { ...config.groups[0], domains: ["x.com", "twitter.com"], apps: [] },
  ];
  config.engine_enabled = true;
  config.active_session = {
    id: "windows-x-regression",
    name: "Fixture",
    group_ids: ["social"],
    started_at: now,
    ends_at: now + 120,
    ended_at: null,
  };
  await writeFile(configPath, JSON.stringify(config));
  engine = spawn(binary, ["--blocker-daemon", temp], { stdio: "ignore" });
  children.push(engine);
  const runtime = async () =>
    JSON.parse(await readFile(join(temp, "runtime.json"), "utf8"));
  await until(async () => {
    const state = await runtime();
    if (state.error) throw new Error(state.error);
    return state.applied_session_id === "windows-x-regression";
  }, "Helper did not confirm the website rules");
  for (const host of ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]) {
    const addresses = await lookup(host, { all: true }).catch((error) => {
      if (["ENOENT", "ENOTFOUND"].includes(error.code))
        return [{ address: "0.0.0.0" }];
      throw error;
    });
    assert(
      addresses.length &&
        addresses.every(({ address }) => ["0.0.0.0", "::"].includes(address)),
      `${host} resolves outside the block: ${JSON.stringify(addresses)}`,
    );
  }
  console.log(
    "PASS: Windows resolver honors x.com, Twitter, www, IPv4 and IPv6 rules",
  );
  const cold = await chrome("new-chrome");
  const blocked = await cold.call("Page.navigate", {
    url: `${url}/new-connection`,
  });
  assert(
    blocked.errorText,
    "Fresh Chrome navigation bypassed the system block",
  );
  console.log("PASS: fresh Chrome navigation is blocked");
  const reused = await warm.call("Page.navigate", {
    url: `${url}/existing-connection`,
  });
  if (reused.errorText) {
    console.log(
      "PASS: already-open Chrome navigation is blocked by system rules",
    );
  } else {
    console.log(
      "CONFIRMED: Chrome reused an existing connection after hosts blocking; the browser companion is required for these tabs",
    );
  }
  // Simulate an external hosts editor and prove the helper repairs it.
  await writeFile(hosts, original);
  await until(
    async () => (await readFile(hosts, "utf8")).includes("0.0.0.0 x.com"),
    "Helper did not repair externally removed rules",
  );
  console.log("PASS: externally removed website rules are repaired");
  config.active_session.ends_at = Math.floor(Date.now() / 1000) - 1;
  await writeFile(configPath, JSON.stringify(config));
  await until(
    async () =>
      !(await readFile(hosts, "utf8")).includes("# BEGIN ARCEO MANAGED BLOCK"),
    "Expired timer did not remove website rules",
  );
  console.log("PASS: timer expiry releases website rules");
  warm.ws.close();
  cold.ws.close();
} finally {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.engine_enabled = false;
    await writeFile(configPath, JSON.stringify(config));
    await delay(1500);
  } catch {
    /* engine may not have started */
  }
  for (const child of children.reverse()) {
    if (child.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        /* exited */
      }
    }
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((yes) => fixture.close(yes));
  await writeFile(hosts, original);
  execFileSync(ipconfig, ["/flushdns"], { windowsHide: true });
  await rm(temp, { recursive: true, force: true });
}

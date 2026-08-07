import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const viteCli = resolve(root, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = resolve(root, "node_modules", "@playwright", "test", "cli.js");
const serverUrl = "http://127.0.0.1:4173";

if (!existsSync(viteCli)) {
  throw new Error(`Could not find Vite CLI at ${viteCli}`);
}
if (!existsSync(playwrightCli)) {
  throw new Error(`Could not find Playwright CLI at ${playwrightCli}`);
}

function spawnNode(script, args, extraEnv = {}) {
  return spawn(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: "inherit",
    windowsHide: true,
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(serverUrl, { method: "GET" });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // keep waiting
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for the Vite dev server at ${serverUrl}`);
}

function killProcessTree(pid) {
  if (!pid) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        cwd: root,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", () => resolvePromise());
      killer.on("error", () => resolvePromise());
    });
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
  return Promise.resolve();
}

const vite = spawnNode(viteCli, ["--host", "127.0.0.1", "--port", "4173"]);
const viteEarlyExit = new Promise((_, reject) => {
  vite.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      reject(new Error(`Vite dev server exited early with code ${code}`));
    }
  });
  vite.on("error", reject);
});

const stopServer = async () => {
  if (!vite.killed) {
    await killProcessTree(vite.pid);
  }
};

process.on("SIGINT", async () => {
  await stopServer();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await stopServer();
  process.exit(143);
});

try {
  await Promise.race([waitForServer(), viteEarlyExit]);

  const playwright = spawnNode(playwrightCli, ["test", "--config", "playwright.config.ts"]);
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    playwright.on("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
    playwright.on("error", rejectExit);
  });
  await Promise.race([stopServer(), delay(5000)]);
  process.exit(exitCode);
} catch (error) {
  await Promise.race([stopServer(), delay(5000)]);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(projectRoot, "dist", "server", "wrangler.json");
const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(configPath)) {
  console.error("RoleSignal has not been built. Run `npm run build` before `npm start`.");
  process.exit(1);
}

const port = Number.parseInt(process.env.PORT || "3000", 10);
const railwayVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const dataDirectory = resolve(
  process.env.ROLESIGNAL_DATA_DIR || (railwayVolume ? join(railwayVolume, "rolesignal") : join(projectRoot, ".wrangler", "state")),
);
mkdirSync(dataDirectory, { recursive: true });

const args = [
  wranglerPath,
  "dev",
  "--config", configPath,
  "--local",
  "--ip", "0.0.0.0",
  "--port", String(Number.isFinite(port) ? port : 3000),
  "--persist-to", dataDirectory,
  "--show-interactive-dev-session=false",
  "--log-level", "info",
];

for (const name of ["ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_API_KEY", "SERPAPI_API_KEY", "INBOUND_EMAIL_SECRET"]) {
  const value = process.env[name];
  if (value) args.push("--var", `${name}:${value}`);
}

const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: join(dataDirectory, "logs"),
    MINIFLARE_REGISTRY_PATH: join(dataDirectory, "registry"),
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});


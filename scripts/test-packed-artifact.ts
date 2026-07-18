import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

interface CommandOptions {
  allowFailure?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

function run(
  command: string,
  args: string[],
  options: CommandOptions = {}
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  }
  return output;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "Could not reserve a port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

async function waitUntilStopped(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
  }
  throw new Error("Packed Workgrove daemon did not stop");
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "workgrove-pack-"));
const packDirectory = join(temporaryRoot, "pack");
const installDirectory = join(temporaryRoot, "consumer");
const fixtureDirectory = join(temporaryRoot, "repository");
const homeDirectory = join(temporaryRoot, "home");
let cliPath = "";
let daemonEnvironment: Record<string, string> = {};

try {
  mkdirSync(installDirectory);
  const tarballName = "workgrove.tgz";
  mkdirSync(packDirectory);
  const tarballPath = join(packDirectory, tarballName);
  run("bun", ["pm", "pack", "--filename", tarballPath, "--quiet"]);
  assert(existsSync(tarballPath), "bun pm pack did not create the tarball");

  const packedFiles = run("tar", ["-tzf", tarballPath]);
  for (const requiredPath of [
    "package/scripts/daemon.ts",
    "package/dist/index.html",
    "package/schema/workgrove.schema.json",
    "package/src/config/public.ts",
  ]) {
    assert(
      packedFiles.split("\n").includes(requiredPath),
      `Packed artifact is missing ${requiredPath}`
    );
  }

  writeFileSync(
    join(installDirectory, "package.json"),
    '{"name":"workgrove-pack-consumer","private":true,"type":"module"}\n',
    { flag: "wx" }
  );
  run("bun", ["add", "--ignore-scripts", tarballPath], {
    cwd: installDirectory,
  });
  cliPath = join(installDirectory, "node_modules", ".bin", "workgrove");
  assert(
    existsSync(cliPath),
    "Packed install did not expose the workgrove CLI"
  );
  run(
    "bun",
    [
      "-e",
      'import { resolveWorkgroveAppGroup } from "workgrove/config"; const appGroup = resolveWorkgroveAppGroup({ version: 2, setup: { argv: ["npm", "install"] }, appGroups: { Apps: { slot: { default: 0, stride: 10 }, start: { argv: ["npm", "run", "dev"] }, stop: "process", apps: { web: { basePort: 4000 } } } } }, "Apps", 0); if (appGroup.apps.web.port !== 4000) process.exit(1);',
    ],
    { cwd: installDirectory }
  );

  run("git", ["init", "--quiet", fixtureDirectory]);
  run("git", ["config", "user.email", "pack-smoke@workgrove.local"], {
    cwd: fixtureDirectory,
  });
  run("git", ["config", "user.name", "Workgrove Pack Smoke"], {
    cwd: fixtureDirectory,
  });
  writeFileSync(join(fixtureDirectory, "README.md"), "# Fixture\n");
  writeFileSync(
    join(fixtureDirectory, ".workgrove.json"),
    `${JSON.stringify(
      {
        version: 1,
        stride: 10,
        setup: { argv: ["npm", "install"] },
        start: { argv: ["npm", "run", "dev"] },
        apps: {
          fixture: { basePort: 45_000 },
        },
      },
      null,
      2
    )}\n`
  );
  run("git", ["add", "."], { cwd: fixtureDirectory });
  run("git", ["commit", "--quiet", "-m", "Create smoke fixture"], {
    cwd: fixtureDirectory,
  });

  const port = await unusedPort();
  daemonEnvironment = {
    HOME: homeDirectory,
    WORKGROVE_NO_OPEN: "1",
    WORKGROVE_PORT: String(port),
  };
  const startOutput = run(cliPath, ["start", "--repo", fixtureDirectory], {
    cwd: installDirectory,
    env: daemonEnvironment,
  });
  assert(startOutput.includes("Workgrove started"), "Packed CLI did not start");
  assert(
    run(cliPath, ["status"], {
      cwd: installDirectory,
      env: daemonEnvironment,
    }).includes("Workgrove is running"),
    "Packed CLI status did not report the daemon"
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = (await health.json()) as { service?: string };
  assert(
    health.ok && healthBody.service === "workgrove",
    "Packed daemon health check failed"
  );
  const workspace = await fetch(
    `${baseUrl}/api/workspace?${new URLSearchParams({ repoPath: fixtureDirectory })}`
  );
  const workspaceBody = (await workspace.json()) as { repoPath?: string };
  assert(
    workspace.ok && workspaceBody.repoPath === realpathSync(fixtureDirectory),
    "Packed daemon did not inspect the disposable Git fixture"
  );
  const ui = await fetch(`${baseUrl}/`);
  const uiHtml = await ui.text();
  assert(
    ui.ok && uiHtml.includes("/assets/"),
    "Packed daemon did not serve the production UI"
  );
  const assetPath = uiHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert(assetPath, "Packed production UI did not reference a built asset");
  assert(
    (await fetch(`${baseUrl}${assetPath}`)).ok,
    "Packed daemon did not serve its built UI asset"
  );

  assert(
    run(cliPath, ["stop"], {
      cwd: installDirectory,
      env: daemonEnvironment,
    }).includes("Workgrove stopped"),
    "Packed CLI did not stop"
  );
  await waitUntilStopped(`${baseUrl}/api/health`);
  const stoppedStatus = run(cliPath, ["status"], {
    allowFailure: true,
    cwd: installDirectory,
    env: daemonEnvironment,
  });
  assert(
    stoppedStatus.includes("Workgrove is stopped"),
    "Packed CLI status did not report the stopped daemon"
  );

  const daemonLog = readFileSync(
    join(homeDirectory, ".workgrove", "server.log"),
    "utf8"
  );
  assert(
    !daemonLog.includes("VITE"),
    "Packed daemon unexpectedly started the Vite development server"
  );
  console.log(
    "Packed Workgrove artifact passed install and daemon smoke tests"
  );
} finally {
  if (cliPath) {
    run(cliPath, ["stop"], {
      allowFailure: true,
      cwd: installDirectory,
      env: daemonEnvironment,
    });
  }
  rmSync(temporaryRoot, { force: true, recursive: true });
}

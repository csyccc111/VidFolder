const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const electronDir = path.join(rootDir, "node_modules", "electron");
const electronPackagePath = path.join(electronDir, "package.json");
const defaultMirror = "https://npmmirror.com/mirrors/electron/";

function platformExecutable() {
  if (process.platform === "win32") return "electron.exe";
  if (process.platform === "darwin") return path.join("Electron.app", "Contents", "MacOS", "Electron");
  return "electron";
}

function isReady() {
  const executable = platformExecutable();
  return (
    fs.existsSync(path.join(electronDir, "path.txt")) &&
    fs.existsSync(path.join(electronDir, "dist", executable))
  );
}

function findCachedZip(version) {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "electron", "Cache");
  const wanted = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const matches = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next);
      } else if (entry.isFile() && entry.name === wanted) {
        matches.push(next);
      }
    }
  }

  walk(cacheRoot);
  return matches
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath;
}

function extractCachedZip(zipPath) {
  const distDir = path.join(electronDir, "dist");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  if (process.platform === "win32") {
    const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const ps = childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath ${quotePowerShell(zipPath)} -DestinationPath ${quotePowerShell(distDir)} -Force`
      ],
      { stdio: "inherit" }
    );
    if (ps.status !== 0) {
      throw new Error(`Expand-Archive failed with exit code ${ps.status}`);
    }
  } else {
    let extractZip;
    try {
      extractZip = require("extract-zip");
    } catch {
      extractZip = require(path.join(electronDir, "node_modules", "extract-zip"));
    }
    return extractZip(zipPath, { dir: distDir }).then(() => {
      fs.writeFileSync(path.join(electronDir, "path.txt"), platformExecutable(), "utf8");
    });
  }

  fs.writeFileSync(path.join(electronDir, "path.txt"), platformExecutable(), "utf8");
}

async function main() {
  if (!fs.existsSync(electronPackagePath)) {
    console.log("[ensure-electron] electron package is not installed yet, skipping.");
    return;
  }

  if (isReady()) {
    console.log("[ensure-electron] Electron binary is ready.");
    return;
  }

  const { version } = JSON.parse(fs.readFileSync(electronPackagePath, "utf8"));
  console.log(`[ensure-electron] Electron ${version} binary is missing, repairing...`);

  const installResult = childProcess.spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || defaultMirror,
      force_no_cache: process.env.force_no_cache || "true"
    }
  });

  if (installResult.status === 0 && isReady()) {
    console.log("[ensure-electron] Electron binary repaired by installer.");
    return;
  }

  const cachedZip = findCachedZip(version);
  if (cachedZip) {
    console.log(`[ensure-electron] Installer did not finish extraction; using cached zip: ${cachedZip}`);
    await extractCachedZip(cachedZip);
    if (isReady()) {
      console.log("[ensure-electron] Electron binary repaired from cache.");
      return;
    }
  }

  console.error("[ensure-electron] Failed to repair Electron binary.");
  console.error("[ensure-electron] Try: npm.cmd run ensure:electron");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

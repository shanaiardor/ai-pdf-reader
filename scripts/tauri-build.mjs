import { spawn } from "node:child_process";

const commandExists = async (command) => {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  return await new Promise((resolve) => {
    const child = spawn(whichCmd, [command], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
};

const hasFuse2 = async () => {
  if (process.platform !== "linux") return false;
  if (await commandExists("ldconfig")) {
    return await new Promise((resolve) => {
      const child = spawn("ldconfig", ["-p"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk.toString("utf-8");
      });
      child.on("close", () => resolve(out.includes("libfuse.so.2")));
      child.on("error", () => resolve(false));
    });
  }
  return await commandExists("fusermount");
};

const pickBundles = async () => {
  const override = process.env.TAURI_BUNDLES?.trim();
  if (override) return override;

  if (process.platform === "win32") return "msi,nsis";
  if (process.platform === "darwin") return "app,dmg";

  if (process.platform === "linux") {
    const bundles = ["deb", "rpm"];
    const hasSquashfs = await commandExists("mksquashfs");
    const fuse2 = await hasFuse2();
    if (hasSquashfs && fuse2) {
      bundles.push("appimage");
    }
    return bundles.join(",");
  }

  return "";
};

const run = async () => {
  const bundles = await pickBundles();
  const args = ["tauri", "build", "--verbose"];
  if (bundles) {
    args.push("--bundles", bundles);
  }
  const extraArgs = process.argv.slice(2);
  args.push(...extraArgs);

  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    stdio: "inherit",
    env: { ...process.env, NO_STRIP: "true" },
  });
  child.on("close", (code) => process.exit(code ?? 1));
};

run();

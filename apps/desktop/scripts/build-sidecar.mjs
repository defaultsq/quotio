// Builds the Quotio CLI and stages it where Tauri's `bundle.externalBin` expects it:
// src-tauri/binaries/quotio-<target-triple>[.exe].
// Usage: node scripts/build-sidecar.mjs [--release] [--target <triple>]
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = resolve(root, "../cli/Cargo.toml");
const args = process.argv.slice(2);
const release = args.includes("--release");
const targetIndex = args.indexOf("--target");
const target =
  targetIndex >= 0
    ? args[targetIndex + 1]
    : execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)[1];

const cargoArgs = ["build", "--manifest-path", manifest, "--locked", "--target", target];
if (release) cargoArgs.push("--release");
execFileSync("cargo", cargoArgs, { stdio: "inherit" });

const extension = target.includes("windows") ? ".exe" : "";
const built = resolve(root, "../cli/target", target, release ? "release" : "debug", `quotio${extension}`);
const staged = join(root, "src-tauri/binaries", `quotio-${target}${extension}`);
mkdirSync(dirname(staged), { recursive: true });
copyFileSync(built, staged);
chmodSync(staged, 0o755);
console.log(`sidecar staged at ${staged}`);

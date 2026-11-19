import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tauri updater platform keys for the native release matrix.
const platforms = {
  "macos-arm64": "darwin-aarch64",
  "macos-x64": "darwin-x86_64",
  "windows-x64": "windows-x86_64",
  "linux-x64": "linux-x86_64",
};

// Each matrix job uploads its updater archive and detached signature under a
// target-unique name: Sumi-<version>-<target>.<ext> and the same name plus ".sig".
const updaterExtensions = [".app.tar.gz", ".exe", ".AppImage"];

export function buildManifest({ version, tag, repository, files, readSignature, notes = "" }) {
  const platformEntries = {};
  for (const [target, key] of Object.entries(platforms)) {
    const name = files.find(
      (file) =>
        file.startsWith(`Sumi-${version}-${target}`) &&
        updaterExtensions.some((ext) => file.endsWith(ext)) &&
        files.includes(`${file}.sig`),
    );
    if (!name) continue;
    platformEntries[key] = {
      signature: readSignature(`${name}.sig`).trim(),
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
    };
  }
  if (!Object.keys(platformEntries).length) {
    throw new Error("No signed updater artifacts found; refusing to publish latest.json.");
  }
  return { version, notes, pub_date: new Date().toISOString(), platforms: platformEntries };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, version, tag, repository] = process.argv.slice(2);
  if (!dir || !version || !tag || !repository) {
    console.error("Usage: node release-manifest.mjs <dir> <version> <tag> <owner/repo>");
    process.exit(1);
  }
  const manifest = buildManifest({
    version,
    tag,
    repository,
    files: readdirSync(dir).map((file) => basename(file)),
    readSignature: (name) => readFileSync(join(dir, name), "utf8"),
  });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote latest.json for ${Object.keys(manifest.platforms).join(", ")}`);
}

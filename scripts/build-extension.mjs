import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const source = resolve(projectRoot, "extension");
const output = resolve(projectRoot, ".extension-dist");
const releaseBuild = process.argv.includes("--release");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  build("chromium", "manifest.json", !releaseBuild),
  build("firefox", "manifest.firefox.json"),
]);

async function build(name, manifestName, includeLocalSite = false) {
  const target = resolve(output, name);
  await cp(source, target, { recursive: true });
  const manifest = JSON.parse(
    await readFile(resolve(source, manifestName), "utf8"),
  );
  if (includeLocalSite) addLocalSiteAccess(manifest);
  await writeFile(
    resolve(target, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rm(resolve(target, "manifest.firefox.json"), { force: true });
}

function addLocalSiteAccess(manifest) {
  const localMatches = ["http://127.0.0.1/*", "http://localhost/*"];
  manifest.host_permissions = [
    ...new Set([...(manifest.host_permissions || []), ...localMatches]),
  ];
  const bridge = manifest.content_scripts?.find((entry) =>
    entry.js?.includes("content/schoolpp.js"),
  );
  if (bridge)
    bridge.matches = [...new Set([...(bridge.matches || []), ...localMatches])];
}

console.log(
  `Extension packages: .extension-dist/chromium and .extension-dist/firefox${releaseBuild ? " (release)" : " (local Chromium access enabled)"}`,
);

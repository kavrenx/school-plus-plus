import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const source = resolve(projectRoot, "extension");
const output = resolve(projectRoot, ".extension-dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  build("chromium", "manifest.json"),
  build("firefox", "manifest.firefox.json"),
  buildLocalChromium(),
]);

async function build(name, manifestName) {
  const target = resolve(output, name);
  await cp(source, target, { recursive: true });
  const manifest = await readFile(resolve(source, manifestName), "utf8");
  await writeFile(resolve(target, "manifest.json"), manifest);
  await rm(resolve(target, "manifest.firefox.json"), { force: true });
}

async function buildLocalChromium() {
  const target = resolve(output, "chromium-local");
  await cp(source, target, { recursive: true });
  const manifest = JSON.parse(
    await readFile(resolve(source, "manifest.json"), "utf8"),
  );
  manifest.name = `${manifest.name} (локальная проверка)`;
  manifest.host_permissions.push(
    "http://127.0.0.1:5173/*",
    "http://localhost:5173/*",
  );
  const schoolppScript = manifest.content_scripts.find((entry) =>
    entry.js.includes("content/schoolpp.js"),
  );
  schoolppScript.matches.push(
    "http://127.0.0.1:5173/*",
    "http://localhost:5173/*",
  );
  await writeFile(
    resolve(target, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rm(resolve(target, "manifest.firefox.json"), { force: true });
}

console.log(
  "Extension packages: .extension-dist/chromium, .extension-dist/firefox and .extension-dist/chromium-local",
);

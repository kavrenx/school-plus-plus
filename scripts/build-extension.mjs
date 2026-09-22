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
]);

async function build(name, manifestName) {
  const target = resolve(output, name);
  await cp(source, target, { recursive: true });
  const manifest = await readFile(resolve(source, manifestName), "utf8");
  await writeFile(resolve(target, "manifest.json"), manifest);
  await rm(resolve(target, "manifest.firefox.json"), { force: true });
}

console.log(
  "Extension packages: .extension-dist/chromium and .extension-dist/firefox",
);

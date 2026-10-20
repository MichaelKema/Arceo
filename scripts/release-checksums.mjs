import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2] || "release-assets";
const files = (await readdir(dir, { withFileTypes: true }))
  .filter((file) => file.isFile() && /\.(dmg|exe)$/.test(file.name))
  .map((file) => file.name)
  .sort();
if (!files.length) throw new Error(`No DMG or EXE installers found in ${dir}`);
const lines = [];
for (const file of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(dir, file)))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${file}`);
}
await writeFile(join(dir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`Created SHA256SUMS.txt for ${files.length} installer(s).`);

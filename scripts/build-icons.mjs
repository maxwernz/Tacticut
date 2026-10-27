// Regenerate native icons from the shared master on macOS. Outputs are committed
// so packaging on Windows does not require Apple's image tools.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Regenerate icons on macOS (requires sips and iconutil).");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "public/app-icon.png");
const work = await mkdtemp(join(tmpdir(), "tacticut-icons-"));
try {
  const iconset = join(work, "app.iconset");
  await mkdir(iconset);
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const images = new Map();
  for (const size of sizes) {
    const path = join(work, `${size}.png`);
    execFileSync("sips", ["-z", String(size), String(size), source, "--out", path], { stdio: "ignore" });
    images.set(size, await readFile(path));
  }
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(join(iconset, `icon_${size}x${size}.png`), images.get(size));
    await writeFile(join(iconset, `icon_${size}x${size}@2x.png`), images.get(size * 2));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(root, "build-assets/app_icon.icns")]);

  // ICO directories can reference PNG images directly, preserving alpha.
  const windowsSizes = [16, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + windowsSizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(windowsSizes.length, 4);
  let offset = header.length;
  windowsSizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    const png = images.get(size);
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(join(root, "build-assets/app_icon.ico"), Buffer.concat([header, ...windowsSizes.map((size) => images.get(size))]));
  console.log("Updated macOS and Windows icons from public/app-icon.png");
} finally {
  await rm(work, { recursive: true, force: true });
}

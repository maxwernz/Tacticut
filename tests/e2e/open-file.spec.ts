import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const requireNative = createRequire(resolve("package.json"));

test("opens an Analysis handed over by Finder or Explorer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "va-open-file-test-"));
  const video = join(dir, "match.mp4"),
    analysis = join(dir, "From Finder.tcut");
  expect(
    spawnSync(requireNative("ffmpeg-static"), [
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25", "-t", "6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ]).status,
  ).toBe(0);
  const source = randomUUID();
  await writeFile(
    analysis,
    JSON.stringify({
      schema_version: 1,
      analysis: {
        id: randomUUID(),
        title: "Scouting Bönnigheim",
        source_videos: [
          { id: source, display_name: "match.mp4", location: video, relative_path: "match.mp4", duration_ms: null, byte_size: null, fingerprint: null },
        ],
        categories: [{ id: randomUUID(), name: "Unterzahl", color: "#EF4444" }],
        clips: [
          { id: randomUUID(), source_video_id: source, name: "Short-handed 16:40", start_ms: 1000, end_ms: 4000, notes: "", category_id: null, creation_order: 0 },
        ],
      },
    }),
  );
  const app = await electron.launch({
    args: [resolve(".")],
    env: { ...process.env, TACTICUT_USER_DATA: join(dir, "user-data") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Add Source video", exact: true })).toBeEnabled();
    // What macOS does on a double-click (Windows passes the path to a second instance).
    await app.evaluate(({ app }, path) => {
      app.emit("open-file", { preventDefault() {} }, path);
    }, analysis);
    await expect(page).toHaveTitle("Scouting Bönnigheim — Tacticut");
    await expect(page.locator(".clip-row").first()).toContainText("Short-handed 16:40");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

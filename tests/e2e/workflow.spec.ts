import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const requireNative = createRequire(resolve("package.json"));
test("desktop workflow: import, mark, edit, filter, save, reopen and recover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "va-desktop-test-"));
  let app: ElectronApplication | undefined;
  const video = join(dir, "match.mp4"),
    analysis = join(dir, "match.analysis");
  const result = spawnSync(requireNative("ffmpeg-static"), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=640x360:r=25",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  expect(result.status).toBe(0);
  try {
    app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, VIDEO_ANALYSE_USER_DATA: join(dir, "user-data") },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("button", { name: "Add Source video", exact: true }),
    ).toBeEnabled();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, video);
    await page
      .getByRole("button", { name: "Add Source video", exact: true })
      .click();
    await expect(page.locator("video")).toBeVisible();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.getByLabel("Analysis title").fill("Opponent preparation");
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 1;
    });
    await page.getByRole("button", { name: /Mark Clip start/ }).click();
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 3;
    });
    await page.getByRole("button", { name: /Mark Clip end/ }).click();
    await page.getByLabel("NAME", { exact: true }).fill("Fast break");
    await page.getByRole("button", { name: "Angriff", exact: true }).click();
    await page
      .getByLabel("NOTES", { exact: true })
      .fill("Watch the passing lane.");
    await page.getByRole("button", { name: "Save Clip", exact: true }).click();
    await expect(page.locator(".clip-info strong")).toHaveText("Fast break");
    await page.getByTitle("Edit Fast break").click();
    await page.getByLabel("NAME", { exact: true }).fill("Discard this edit");
    await page
      .locator(".clip-editor")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.locator(".clip-info strong")).toHaveText("Fast break");
    await page.getByLabel("Search Clips").fill("missing");
    await expect(page.getByText("No matching Clips")).toBeVisible();
    await page.getByLabel("Search Clips").fill("");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, analysis);
    await page.getByTitle("Save Analysis").click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    const saved = JSON.parse(await readFile(analysis, "utf8"));
    expect(saved.schema_version).toBe(1);
    expect(saved.analysis.clips[0].name).toBe("Fast break");
    expect(saved.analysis.clips[0].start_ms).toBe(1000);
    expect(saved.analysis.clips[0].end_ms).toBe(3000);
    await page.getByTitle("Annotate selected Clip").click();
    const annotation = page.getByRole("dialog", {
      name: "Freeze-frames · Fast break",
    });
    await annotation.getByTitle("Next annotation frame").click();
    await expect(annotation.locator(".annotation-loading")).toHaveCount(0);
    const canvas = annotation.getByRole("img", {
      name: "Draw on frozen video",
    });
    const box = (await canvas.boundingBox())!;
    const draw = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(box.x + x1 * box.width, box.y + y1 * box.height);
      await page.mouse.down();
      await page.mouse.move(box.x + x2 * box.width, box.y + y2 * box.height, {
        steps: 6,
      });
      await page.mouse.up();
    };
    await draw(0.2, 0.5, 0.8, 0.5);
    await annotation
      .getByRole("button", { name: "Circle", exact: true })
      .click();
    await draw(0.2, 0.2, 0.4, 0.4);
    await expect(canvas.locator("g")).toHaveCount(2);
    await page.screenshot({ path: "test-results/freeze-frame-editor.png" });
    await annotation
      .getByRole("button", { name: "Save freeze-frames" })
      .click();
    await expect(annotation).toHaveCount(0);
    await page.getByTitle("Save Analysis").click();
    await expect
      .poll(
        async () => JSON.parse(await readFile(analysis, "utf8")).schema_version,
      )
      .toBe(3);
    expect(
      JSON.parse(await readFile(analysis, "utf8")).analysis.freeze_frames[0]
        .shapes,
    ).toHaveLength(2);
    await page.getByTitle("Review Clip with freeze-frames").click();
    await expect(page.locator(".freeze-playback-label")).toBeVisible();
    await page.getByRole("button", { name: "Continue now" }).click();
    await expect(page.locator(".freeze-playback-label")).toHaveCount(0);
    await page.getByTitle("Manage Categories").click();
    await page.getByLabel("Category name").nth(1).fill("Attack");
    await page.getByRole("button", { name: "Save Categories" }).click();
    await expect(page.locator(".category-heading")).toContainText("Attack");
    await expect
      .poll(
        async () =>
          JSON.parse(
            await readFile(join(dir, "user-data", "recovery.json"), "utf8"),
          ).analysis.categories[1].name,
      )
      .toBe("Attack");
    await page.screenshot({ path: "test-results/workspace.png" });
    expect(errors).toEqual([]);
    await app.evaluate(({ app }) => app.exit(0));
    app = undefined;
    app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, VIDEO_ANALYSE_USER_DATA: join(dir, "user-data") },
    });
    const recovered = await app.firstWindow();
    await recovered
      .getByRole("button", { name: "Restore Analysis", exact: true })
      .click();
    await expect(recovered.locator(".category-heading")).toContainText(
      "Attack",
    );
    await expect(recovered.locator(".clip-info strong")).toHaveText(
      "Fast break",
    );
    await recovered.getByTitle("Save Analysis").click();
    await expect(recovered.getByRole("status")).toContainText("Analysis saved");
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

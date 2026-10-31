import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const req = createRequire(resolve("package.json"));
test("speed-aware arrows and the unified tagging panel persist one scene with multiple categories", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-tagging-"));
  let app: ElectronApplication | undefined;
  try {
    const footage = process.env.TACTICUT_TEST_VIDEO || join(dir, "match.mp4");
    if (!process.env.TACTICUT_TEST_VIDEO)
      expect(
        spawnSync(req("ffmpeg-static"), [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=s=640x360:r=30",
          "-t",
          "70",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          footage,
        ]).status,
      ).toBe(0);
    app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, TACTICUT_USER_DATA: join(dir, "profile") },
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
    }, footage);
    await page
      .getByRole("button", { name: "Add Source video", exact: true })
      .click();
    const main = page.locator(".player-panel video");
    await expect
      .poll(() => main.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    const choose = async (label: string, option: string) => {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    const seek = async (seconds: number) => {
      await main.evaluate((v: HTMLVideoElement, n) => {
        v.pause();
        v.currentTime = n;
      }, seconds);
      await expect
        .poll(() => main.evaluate((v: HTMLVideoElement) => !v.seeking))
        .toBe(true);
    };
    await choose("Appearance", "Light appearance");
    await choose("Playback speed", "8×");
    await seek(10);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => main.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(10.24);
    expect(
      await main.evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBeLessThan(10.3);
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() => main.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(10, 2);
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(() => main.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(50, 1);
    await seek(60);
    await page.keyboard.press("t");
    const panel = page.getByRole("dialog", { name: "Tag play", exact: true });
    await expect(panel).toBeVisible();
    await page.getByLabel("NAME", { exact: true }).fill("QA combined play");
    await page.getByRole("button", { name: "Angriff", exact: true }).click();
    await page.getByRole("button", { name: "Tor", exact: true }).click();
    await page.getByLabel("Attacking team", { exact: true }).fill("QA Home");
    await page
      .getByLabel("Attacking player", { exact: true })
      .fill("QA Player");
    await page
      .getByRole("button", { name: "Outcome Goal", exact: true })
      .click();
    await page.getByRole("button", { name: "Fast break", exact: true }).click();
    await page
      .getByRole("button", { name: "Shot origin Left wing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Target Top left", exact: true })
      .click();
    expect(await page.locator(".clip-row").count()).toBe(0);
    await page.screenshot({
      path: "test-results/tagging-light.png",
      animations: "disabled",
    });
    await panel.press("Control+Enter");
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".clip-row")).toHaveCount(1);
    const file = join(dir, "tagging.analysis");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, file);
    await page.getByTitle("Save Analysis").click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    const stored = JSON.parse(await readFile(file, "utf8"));
    expect(stored.schema_version).toBe(7);
    expect(stored.analysis.clips).toHaveLength(1);
    expect(stored.analysis.clips[0].category_ids).toHaveLength(2);
    expect(stored.analysis.clips[0].handball).toMatchObject({
      outcome: "goal",
      phase: "fast-break",
      shot_position: "left-wing",
      goal_zone: "top-left",
    });
    await page.getByTitle("Edit QA combined play").click();
    await expect(
      page.getByRole("button", { name: "Tor", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Outcome Saved shot", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Outcome Goal", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await page.getByText("Coaching themes", { exact: true }).click();
    await page
      .getByRole("button", { name: "Filter theme Angriff", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Filter theme Tor", exact: true })
      .click();
    await expect(page.locator(".handball-stat-grid strong").first()).toHaveText(
      "1",
    );
    await page.getByTitle("Save current handball view").click();
    await page.getByLabel("View name").fill("Attack goals");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTitle("Save Analysis").click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(file, "utf8")).analysis.handball_views?.[0]
            ?.category_ids?.length,
      )
      .toBe(2);
    await choose("Appearance", "Dark appearance");
    await page.getByTitle("Tag play (T)").click();
    await expect(
      page.getByRole("button", { name: "Outcome Goal", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 680),
    );
    await expect(
      page.getByRole("button", { name: "Save Clip", exact: true }),
    ).toBeInViewport();
    await expect
      .poll(() =>
        page
          .locator(".tagging-preview-frame video")
          .evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.seeking),
      )
      .toBe(true);
    await page.screenshot({
      path: "test-results/tagging-dark-compact.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const requireNative = createRequire(resolve("package.json"));
async function choose(page: Page, label: string, option: string) {
  const group = page.getByRole("group", { name: label, exact: true });
  if (
    (await group.count()) &&
    [
      "Recorded outcome",
      "Tactical phase",
      "Shot origin",
      "Defense faced",
      "Attacking strength",
    ].includes(label)
  ) {
    const prefix =
      label === "Recorded outcome"
        ? "Outcome "
        : label === "Shot origin"
          ? "Shot origin "
          : "";
    await group
      .getByRole("button", { name: prefix + option, exact: true })
      .click();
    return;
  }
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("handball: code clips, persist tags, combine filters and export the exact review", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-handball-e2e-"));
  const video = join(dir, "match.mp4"),
    analysis = join(dir, "match.analysis"),
    output = join(dir, "review.mp4");
  expect(
    spawnSync(requireNative("ffmpeg-static"), [
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
    ]).status,
  ).toBe(0);
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, TACTICUT_USER_DATA: join(dir, "profile") },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    async function seek(seconds: number) {
      await page.locator("video").evaluate((v: HTMLVideoElement, time) => {
        v.pause();
        v.currentTime = time;
      }, seconds);
      await expect
        .poll(() =>
          page.locator("video").evaluate((v: HTMLVideoElement) => !v.seeking),
        )
        .toBe(true);
    }
    async function create(
      name: string,
      start: number,
      team: string,
      outcome: string,
    ) {
      await seek(start);
      await page.getByRole("button", { name: /Mark Clip start/ }).click();
      await seek(start + 1);
      await page.getByRole("button", { name: /Mark Clip end/ }).click();
      await page.getByLabel("NAME", { exact: true }).fill(name);
      await page.getByLabel("Attacking team", { exact: true }).fill(team);
      await page
        .getByLabel("Attacking player", { exact: true })
        .fill("7 Meyer");
      await page
        .getByLabel("Defending goalkeeper", { exact: true })
        .fill("12 Keeper");
      await choose(page, "Tactical phase", "Fast break");
      await choose(page, "Recorded outcome", outcome);
      await choose(page, "Shot origin", "Left wing");
      await page
        .getByRole("button", { name: "Target Top left", exact: true })
        .click();
      if (name === "Home goal")
        await page.screenshot({ path: "test-results/handball-editor.png" });
      await page
        .getByRole("button", { name: "Save Clip", exact: true })
        .click();
      await expect(
        page.locator(".clip-info strong").filter({ hasText: name }),
      ).toHaveCount(1);
    }
    await create("Home goal", 0.5, "Home", "Goal");
    await create("Home save", 2, "Home", "Saved shot");
    await create("Away goal", 4, "Away", "Goal");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, analysis);
    const saved = async () => JSON.parse(await readFile(analysis, "utf8"));
    await page.getByTitle("Save Analysis").click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    await expect.poll(async () => (await saved()).schema_version).toBe(4);
    const initial = await saved();
    const goalId = initial.analysis.clips.find(
      (clip: { name: string }) => clip.name === "Home goal",
    ).id;
    expect(initial.analysis.clips[0].handball).toMatchObject({
      team: "Home",
      player: "7 Meyer",
      goalkeeper: "12 Keeper",
      phase: "fast-break",
      outcome: "goal",
      shot_position: "left-wing",
      goal_zone: "top-left",
    });

    // Cancel keeps the saved structured tags untouched.
    await page.getByTitle("Edit Home goal").click();
    await page
      .getByLabel("Attacking team", { exact: true })
      .fill("Discarded team");
    await page
      .locator(".tagging-workspace")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await app.evaluate(
      ({ app }, path) => app.emit("open-file", { preventDefault() {} }, path),
      analysis,
    );
    await expect(page.locator(".clip-info strong")).toHaveCount(3);
    await page.getByTitle("Edit Home goal").click();
    await expect(
      page.getByLabel("Attacking team", { exact: true }),
    ).toHaveValue("Home");
    await page
      .locator(".tagging-workspace")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();

    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await choose(page, "Filter Team", "Home");
    await choose(page, "Filter Outcome", "Goal");
    await page.getByText("Shot maps", { exact: true }).click();
    await page
      .getByRole("button", { name: "Shot position Left wing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Goal target Top left", exact: true })
      .click();
    await expect(page.locator(".handball-result")).toHaveCount(1);
    await expect(page.locator(".handball-result")).toContainText("Home goal");
    await expect(
      page.getByRole("region", { name: "Tagged handball statistics" }),
    ).toContainText("100%");
    await page.locator(".handball-goal-grid").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/handball-panel.png" });
    await page
      .getByRole("button", { name: "Export matching", exact: true })
      .click();
    const exportDialog = page.getByRole("dialog", { name: "Combined export" });
    await expect(exportDialog.locator(".export-row")).toHaveCount(1);
    await expect(exportDialog.locator(".export-row")).toContainText(
      "Home goal",
    );
    for (const label of [
      "Analysis title card",
      "Category title cards",
      "Notes cards",
      "Clip numbers",
    ])
      await exportDialog.getByLabel(label, { exact: true }).uncheck();
    await choose(page, "Resolution", "720p");
    await choose(page, "Encoder", "Software (H.264)");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, output);
    await exportDialog
      .getByRole("button", { name: "Export video…", exact: true })
      .click();
    await expect(exportDialog).toHaveCount(0, { timeout: 45000 });
    const probe = spawnSync(
      requireNative("@ffprobe-installer/ffprobe").path,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(probe.status).toBe(0);
    expect(Number(JSON.parse(probe.stdout).format.duration)).toBeCloseTo(1, 1);

    await page
      .getByRole("button", { name: "Create review playlist", exact: true })
      .click();
    await page.getByTitle("Save Analysis").click();
    await expect
      .poll(async () => (await saved()).analysis.playlists.length)
      .toBe(1);
    expect((await saved()).analysis.playlists[0].clip_ids).toEqual([goalId]);

    await page.getByRole("button", { name: /^Clips/ }).click();
    await page.getByTitle("Edit Home goal").click();
    await page
      .getByRole("button", { name: "Clear all tags", exact: true })
      .click();
    await page.getByRole("button", { name: "Save Clip", exact: true }).click();
    await page.getByTitle("Save Analysis").click();
    await expect
      .poll(async () => (await saved()).analysis.clips[0].handball ?? null)
      .toBeNull();
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

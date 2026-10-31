import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const requireNative = createRequire(resolve("package.json"));
const video = process.env.TACTICUT_TEST_VIDEO;
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

// Opt in to real local footage; ordinary CI remains independent of personal files.
test("real footage: batch coding, saved views, reports, player reviews and replay export", async () => {
  test.skip(!video, "Set TACTICUT_TEST_VIDEO to a local handball recording.");
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-coaching-e2e-"));
  await mkdir("test-results", { recursive: true });
  const analysisPath = join(dir, "coaching.analysis");
  const reportPath = resolve("test-results/handball-real-report.pdf");
  const csvPath = resolve("test-results/handball-real-data.csv");
  const outputPath = resolve("test-results/handball-real-replay.mp4");
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
    await choose(page, "Appearance", "Light appearance");
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, video!);
    await page
      .getByRole("button", { name: "Add Source video", exact: true })
      .click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.duration),
      )
      .toBeGreaterThan(80);
    await page
      .getByLabel("Analysis title")
      .fill("Handball feature QA · synthetic tags on real footage");
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
    async function create(name: string, start: number, withContext = false) {
      await seek(start);
      await page.getByRole("button", { name: /Mark Clip start/ }).click();
      await seek(start + 2);
      await page.getByRole("button", { name: /Mark Clip end/ }).click();
      await page.getByLabel("NAME", { exact: true }).fill(name);
      await page
        .getByLabel("NOTES", { exact: true })
        .fill(
          "QA labels only; no match event or outcome inferred from this footage.",
        );
      if (withContext) {
        await page
          .getByLabel("Defending goalkeeper", { exact: true })
          .fill("QA Keeper");
        await choose(page, "Tactical phase", "Fast break");
        await choose(page, "Shot origin", "Left wing");
        await page
          .getByRole("button", { name: "Target Top left", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "Save Clip", exact: true })
        .click();
      await expect(
        page.locator(".clip-info strong").filter({ hasText: name }),
      ).toHaveCount(1);
    }
    await create("QA shot one", 60, true);
    await create("QA shot two", 65);
    await create("QA excluded clip", 70);
    await page
      .getByRole("button", { name: "Select clips", exact: true })
      .click();
    await page
      .getByLabel("Select QA shot one for export", { exact: true })
      .check();
    await page
      .getByLabel("Select QA shot two for export", { exact: true })
      .check();
    await page.getByTitle("Tag selected Clips", { exact: true }).click();
    const tagging = page.getByRole("dialog", {
      name: "Tag 2 selected Clips",
      exact: true,
    });
    await tagging.getByLabel("Attacking team", { exact: true }).fill("QA Team");
    await tagging
      .getByLabel("Attacking player", { exact: true })
      .fill("QA Player");
    await choose(page, "Recorded outcome", "Goal");
    await tagging
      .getByRole("button", { name: "Apply tags", exact: true })
      .click();
    await expect(tagging).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await choose(page, "Filter Team", "QA Team");
    await choose(page, "Filter Outcome", "Goal");
    await expect(page.locator(".handball-result")).toHaveCount(2);
    await expect(page.locator(".handball-result")).not.toContainText([
      "QA excluded clip",
    ]);
    await page
      .getByTitle("Save current handball view", { exact: true })
      .click();
    await page.getByLabel("View name", { exact: true }).fill("QA player goals");
    await page
      .locator(".saved-views")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, analysisPath);
    await page.getByTitle("Save Analysis", { exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    const readAnalysis = async () =>
      JSON.parse(await readFile(analysisPath, "utf8"));
    const saved = await readAnalysis();
    expect(saved.schema_version).toBe(5);
    expect(saved.analysis.handball_views).toHaveLength(1);
    expect(saved.analysis.handball_views[0]).toMatchObject({
      name: "QA player goals",
      filters: { team: "QA Team", outcome: "goal" },
    });
    expect(saved.analysis.clips[0].handball).toMatchObject({
      team: "QA Team",
      player: "QA Player",
      outcome: "goal",
      goalkeeper: "QA Keeper",
      phase: "fast-break",
      shot_position: "left-wing",
      goal_zone: "top-left",
    });
    expect(saved.analysis.clips[1].handball).toMatchObject({
      team: "QA Team",
      player: "QA Player",
      outcome: "goal",
    });
    expect(saved.analysis.clips[2].handball).toBeUndefined();
    const expectedIds = saved.analysis.clips
      .slice(0, 2)
      .map((clip: { id: string }) => clip.id);

    // Reload from disk and restore the saved query instead of relying on component state.
    await app.evaluate(
      ({ app }, path) => app.emit("open-file", { preventDefault() {} }, path),
      analysisPath,
    );
    await expect(
      page.getByRole("combobox", { name: "Saved handball views", exact: true }),
    ).toBeVisible();
    await choose(page, "Saved handball views", "QA player goals");
    await expect(page.locator(".handball-result")).toHaveCount(2);
    await page.locator(".handball-summary").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/handball-real-statistics.png",
    });
    await page
      .getByRole("button", { name: "Play matching", exact: true })
      .click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThanOrEqual(60);
    await page.getByTitle("Stop Clip review", { exact: true }).click();

    await page.getByText("Reports & player reviews", { exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, reportPath);
    await page
      .getByRole("button", { name: "Shooting report (PDF)", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Saved PDF report");
    const pdf = await readFile(reportPath);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, csvPath);
    await page
      .getByRole("button", { name: "Clip data (CSV)", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Saved CSV report");
    const csv = await readFile(csvPath, "utf8");
    expect(csv).toContain("QA shot one");
    expect(csv).toContain("QA shot two");
    expect(csv).not.toContain("QA excluded clip");
    expect(csv).toContain("Fast break");
    expect(csv).toContain("QA Player");
    await page
      .getByRole("button", { name: "Create 1 player playlists", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/handball-real-reports.png" });
    await page
      .getByRole("button", { name: "Create 1 player playlists", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Coaching playlist", exact: true }),
    ).toContainText("QA Team · QA Player");
    await page.getByTitle("Save Analysis", { exact: true }).click();
    await expect
      .poll(async () => (await readAnalysis()).analysis.playlists.length)
      .toBe(1);
    expect((await readAnalysis()).analysis.playlists[0].clip_ids).toEqual(
      expectedIds,
    );

    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await choose(page, "Saved handball views", "QA player goals");
    await page
      .getByLabel("Search handball clips", { exact: true })
      .fill("QA shot one");
    await expect(page.locator(".handball-result")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Export matching", exact: true })
      .click();
    const exporting = page.getByRole("dialog", {
      name: "Combined export",
      exact: true,
    });
    await expect(exporting.locator(".export-row")).toHaveCount(1);
    for (const label of [
      "Analysis title card",
      "Category title cards",
      "Notes cards",
      "Clip numbers",
    ])
      await exporting.getByLabel(label, { exact: true }).uncheck();
    await choose(page, "Resolution", "720p");
    await choose(page, "Encoder", "Software (H.264)");
    await exporting.getByText("Presentation", { exact: true }).click();
    await exporting
      .getByLabel("Add a slow-motion replay after each Clip", { exact: true })
      .check();
    await choose(page, "Replay speed", "Half speed (0.5×)");
    await expect(
      exporting.getByText("Each original plays first", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/handball-real-presentation.png",
    });
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, outputPath);
    await exporting
      .getByRole("button", { name: "Export video…", exact: true })
      .click();
    await expect(exporting).toHaveCount(0, { timeout: 90000 });
    const info = spawnSync(
      requireNative("@ffprobe-installer/ffprobe").path,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    expect(info.status).toBe(0);
    expect(
      Number(JSON.parse(info.stdout).format.duration),
    ).toBeGreaterThanOrEqual(5.9);
    expect(Number(JSON.parse(info.stdout).format.duration)).toBeLessThan(6.3);
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

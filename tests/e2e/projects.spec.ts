import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  readdir,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { newAnalysis, encode } from "../../src/domain";
const req = createRequire(resolve("package.json"));
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("projects, stable rosters, templates, history, drawing controls and player exports work together", async () => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-projects-e2e-"));
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
          "testsrc2=s=640x360:r=25",
          "-t",
          "6",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          footage,
        ]).status,
      ).toBe(0);
    const roster = {
      teams: [{ id: crypto.randomUUID(), name: "Home" }],
      players: [
        {
          id: crypto.randomUUID(),
          team_id: "",
          name: "Alex",
          number: "7",
          goalkeeper: false,
        },
      ],
    };
    roster.players[0].team_id = roster.teams[0].id;
    const paths: string[] = [];
    for (const name of ["Match one", "Match two"]) {
      const a = newAnalysis();
      a.title = name;
      a.roster = structuredClone(roster);
      a.source_videos = [
        {
          id: crypto.randomUUID(),
          display_name: "Match footage",
          location: footage,
          relative_path: null,
          duration_ms: 6000,
          byte_size: null,
          fingerprint: null,
        },
      ];
      a.clips = [
        {
          id: crypto.randomUUID(),
          source_video_id: a.source_videos[0].id,
          name: `${name} goal`,
          start_ms: 1000,
          end_ms: 2000,
          notes: "QA synthetic tags",
          category_id: a.categories[0].id,
          creation_order: 0,
          handball: {
            team: "Home",
            team_id: roster.teams[0].id,
            player: "Alex",
            player_id: roster.players[0].id,
            outcome: "goal",
          },
        },
      ];
      const path = join(dir, `${name}.analysis`);
      paths.push(path);
      await writeFile(path, encode(a));
    }
    const originals = await Promise.all(paths.map((p) => readFile(p, "utf8")));
    app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, TACTICUT_USER_DATA: join(dir, "profile") },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByTitle("Projects and collections")).toBeEnabled();
    await choose(page, "Appearance", "Light appearance");
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    }, paths);
    await page.getByTitle("Projects and collections").click();
    await page
      .getByRole("button", { name: "Browse projects", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Select Match one", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Select Match two", exact: true })
      .check();
    await page.getByLabel("Collection name").fill("Season review");
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await expect(page.getByLabel("Analysis title")).toHaveValue(
      "Season review",
    );
    await expect(page.locator(".handball-stat-grid strong").first()).toHaveText(
      "2",
    );
    await choose(
      page,
      "Analysis actions",
      "Project setup · roster & templates",
    );
    await page.getByLabel("Player name", { exact: true }).fill("Alex renamed");
    await page.getByRole("tab", { name: "Reusable templates" }).click();
    await page
      .getByLabel("Template name", { exact: true })
      .fill("Season squad");
    await page
      .getByRole("button", { name: "Save current setup as template" })
      .click();
    const templatePath = join(dir, "squad-template.json");
    await app.evaluate(({ BrowserWindow }, path) => {
      BrowserWindow.getAllWindows()[0].webContents.session.once(
        "will-download",
        (_event, item) => item.setSavePath(path),
      );
    }, templatePath);
    await page
      .getByRole("button", {
        name: "Export template Season squad",
        exact: true,
      })
      .click();
    await expect
      .poll(async () =>
        readFile(templatePath, "utf8")
          .then(JSON.parse)
          .catch(() => null),
      )
      .toMatchObject({ format: "tacticut-setup", version: 1 });
    await page.getByRole("tab", { name: "Teams & players" }).click();
    await page.screenshot({
      path: "test-results/project-roster.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Apply setup", exact: true })
      .click();
    const savePath = join(dir, "season.analysis");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, savePath);
    await page.getByTitle("Save Analysis").click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    expect(
      JSON.parse(await readFile(savePath, "utf8")).analysis.clips.every(
        (c: any) => c.handball.player === "Alex renamed",
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Undo project edit", exact: true })
      .click();
    await expect(page.locator(".dirty-dot")).toHaveCount(1);
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()!
        .items.find((i) => i.label === "Edit")!
        .submenu!.items.find((i) => i.label === "Redo")!
        .click();
    });
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    await page.getByLabel("Analysis title").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByLabel("Analysis title")).not.toHaveValue(
      "Season review edited",
    );
    await page.getByLabel("Analysis title").fill("Season review");
    await choose(page, "Analysis actions", "Manage Categories");
    await page.getByLabel("Group for Abwehr", { exact: true }).fill("Defense");
    await choose(page, "Shortcut for Abwehr", "Key 8");
    await page.screenshot({
      path: "test-results/project-categories.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Save Categories", exact: true })
      .click();
    await page.getByRole("button", { name: "Clips 2", exact: true }).click();
    await page.locator(".clip-info strong").first().click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 1.5;
    });
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => !v.seeking),
      )
      .toBe(true);
    await page.getByTitle("Annotate selected Clip").click();
    const dialog = page.getByRole("dialog", { name: /Freeze-frames/ });
    await expect(dialog.locator(".annotation-loading")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Text", exact: true }).click();
    await dialog
      .getByLabel("Drawing text", { exact: true })
      .fill("Attack the space");
    const svg = dialog.getByRole("img", { name: "Draw on frozen video" });
    const b = (await svg.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5);
    await page.mouse.up();
    await dialog.getByRole("button", { name: "Select", exact: true }).click();
    await choose(page, "Selected drawing", "1 · text · Attack the space");
    await dialog
      .getByRole("button", { name: "Delete selected", exact: true })
      .click();
    await dialog.getByTitle("Undo drawing edit").click();
    await choose(page, "Selected drawing", "1 · text · Attack the space");
    const hit = svg.locator("rect[data-shape-id]");
    await hit.dragTo(hit, {
      sourcePosition: { x: 30, y: 20 },
      targetPosition: { x: 50, y: 30 },
    });
    await page.screenshot({
      path: "test-results/project-drawings.png",
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Save freeze-frames", exact: true })
      .click();
    await page.getByTitle("Save Analysis").click();
    await expect(page.getByRole("status")).toContainText("Analysis saved");
    const saved = JSON.parse(await readFile(savePath, "utf8"));
    expect(saved.analysis.freeze_frames[0].shapes[0].text).toBe(
      "Attack the space",
    );
    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await page.getByText("Reports & player reviews", { exact: true }).click();
    await page
      .getByRole("button", { name: "Export player videos…", exact: true })
      .click();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, dir);
    await page
      .getByRole("button", { name: "Export 1 player video", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Export player videos" }),
    ).toHaveCount(0, { timeout: 90000 });
    const outputDir = join(
      dir,
      (await readdir(dir)).find((p) =>
        p.startsWith("Tacticut-player-reviews-"),
      )!,
    );
    expect(
      (await readdir(outputDir)).filter((p) => p.endsWith(".mp4")),
    ).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(outputDir, "review-index.json"), "utf8")),
    ).toMatchObject({ status: "complete", total: 1 });
    await page.getByTitle("Projects and collections").click();
    await expect(
      page.getByRole("button", { name: "Open Match one", exact: true }),
    ).toBeVisible();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/projects-library.png",
      animations: "disabled",
    });
    expect(await Promise.all(paths.map((p) => readFile(p, "utf8")))).toEqual(
      originals,
    );
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

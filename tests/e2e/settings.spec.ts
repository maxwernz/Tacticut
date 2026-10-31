import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { newAnalysis, encode } from "../../src/domain";
import { tourSteps } from "../../src/WelcomeTour";
import { tFor } from "../../src/i18n";
const req = createRequire(resolve("package.json"));
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("German and English settings persist, translate handball and tour, and preserve project data", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-settings-"));
  const profile = join(dir, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "language.json"),
    JSON.stringify({ language: "en" }),
  );
  await mkdir("test-results", { recursive: true });
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
        "10",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        footage,
      ]).status,
    ).toBe(0);
  const project = newAnalysis();
  project.title = "Goal";
  project.categories[0].name = "Saved shot";
  const sourceId = crypto.randomUUID();
  project.source_videos = [
    {
      id: sourceId,
      display_name: "Start",
      location: footage,
      relative_path: null,
      duration_ms: null,
      byte_size: null,
      fingerprint: null,
    },
  ];
  project.clips = [
    {
      id: crypto.randomUUID(),
      source_video_id: sourceId,
      name: "Save",
      notes: "Shot position",
      start_ms: 1000,
      end_ms: 3000,
      category_id: project.categories[0].id,
      creation_order: 0,
      handball: {
        team: "Start",
        player: "Goal",
        outcome: "goal",
        shot_position: "left-wing",
      },
    },
  ];
  const projectPath = join(dir, "language.analysis"),
    original = encode(project);
  await writeFile(projectPath, original);
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  const launch = () =>
    electron.launch({
      args: [resolve(".")],
      env: { ...process.env, TACTICUT_USER_DATA: profile },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeEnabled();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(page.locator(".clip-info strong")).toHaveText("Save");
    const loaded = await page.getByLabel("Analysis title").inputValue();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await choose(page, "App language", "Deutsch");
    await expect(
      page.getByRole("dialog", { name: "Einstellungen", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const labels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.map((item) => item.label),
    );
    expect(labels).toEqual(
      expect.arrayContaining(["Datei", "Bearbeiten", "Ansicht", "Hilfe"]),
    );
    await choose(page, "Design", "Helle Darstellung");
    await page
      .getByRole("spinbutton", {
        name: "Einstellungen: Sekunden davor",
        exact: true,
      })
      .fill("");
    await page.getByRole("button", { name: "Fertig", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Einstellungen", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("spinbutton", {
        name: "Einstellungen: Sekunden davor",
        exact: true,
      })
      .fill("12");
    await page
      .getByRole("spinbutton", {
        name: "Einstellungen: Sekunden danach",
        exact: true,
      })
      .fill("4");
    await page
      .getByRole("spinbutton", {
        name: "Einstellungen: Sprungweite",
        exact: true,
      })
      .fill("7");
    await page
      .getByRole("spinbutton", {
        name: "Einstellungen: Sprungweite",
        exact: true,
      })
      .blur();
    await page.screenshot({
      path: "test-results/settings-german-light.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Fertig", exact: true }).click();
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    await expect(page.getByLabel("Titel der Analyse")).toHaveValue(loaded);
    expect(
      await page.evaluate(() => localStorage.getItem("capture-window")),
    ).toBe('{"before":12,"after":4}');
    expect(
      await page.evaluate(() => localStorage.getItem("navigation-jump")),
    ).toBe("7");
    await page
      .locator(".clip-info strong")
      .filter({ hasText: /^Save$/ })
      .dblclick();
    const tagging = page.getByRole("dialog", {
      name: "Szene markieren",
      exact: true,
    });
    await expect(tagging).toBeVisible();
    await expect(
      tagging.getByRole("button", { name: "Saved shot", exact: true }),
    ).toBeVisible();
    await expect(
      tagging.getByLabel("Angreifender Spieler", { exact: true }),
    ).toHaveValue("Goal");
    await expect(
      tagging.getByRole("button", { name: "Ergebnis Tor", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      tagging.getByRole("button", {
        name: "Wurfposition Linksaußen",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(tagging.getByLabel("NOTIZEN", { exact: true })).toHaveValue(
      "Shot position",
    );
    await page.screenshot({
      path: "test-results/tagging-german.png",
      animations: "disabled",
    });
    await tagging
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await page.getByRole("button", { name: "Handball", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Handballclips suchen", exact: true })
      .fill("Tor");
    await expect(page.locator(".handball-result")).toHaveCount(1);
    await choose(page, "Ergebnis filtern", "Gehaltener Wurf");
    await expect(page.locator(".handball-result")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Handballfilter zurücksetzen", exact: true })
      .click();
    await page.locator('[data-tour="reports"] summary').click();
    const reportPath = resolve("test-results/handball-german-report.pdf"),
      csvPath = resolve("test-results/handball-german-data.csv");
    await rm(reportPath, { force: true });
    await rm(csvPath, { force: true });
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, reportPath);
    await page
      .getByRole("button", {
        name: tFor("de", "Shooting report (PDF)"),
        exact: true,
      })
      .click();
    await expect
      .poll(async () =>
        (await readFile(reportPath).catch(() => Buffer.from("")))
          .subarray(0, 5)
          .toString(),
      )
      .toBe("%PDF-");
    await expect(
      page.getByRole("button", { name: "Einstellungen", exact: true }),
    ).toBeEnabled();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, csvPath);
    await page
      .getByRole("button", { name: tFor("de", "Clip data (CSV)"), exact: true })
      .click();
    await expect
      .poll(async () => await readFile(csvPath, "utf8").catch(() => ""))
      .toContain('"Tor","Linksaußen"');
    expect(await readFile(csvPath, "utf8")).toContain(
      '"Saved shot","Start","Goal"',
    );
    await expect(
      page.getByRole("button", { name: "Einstellungen", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Einführung", exact: true }).click();
    for (let i = 0; i < tourSteps.length; i++) {
      const tour = page.getByRole("dialog", {
        name: tFor("de", tourSteps[i].title),
        exact: true,
      });
      await expect(tour).toBeVisible();
      await expect(tour.locator("#tour-text")).toHaveText(
        tFor("de", tourSteps[i].text),
      );
      await tour
        .getByRole("button", {
          name: i === tourSteps.length - 1 ? "Einführung beenden" : "Weiter",
          exact: true,
        })
        .click();
    }
    expect(await readFile(projectPath, "utf8")).toBe(original);
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    await app.evaluate(({ app }) => app.exit(0));
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("button", { name: "Einstellungen", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Einstellungen", exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", {
        name: "Einstellungen: Sekunden davor",
        exact: true,
      }),
    ).toHaveValue("12");
    await expect(
      page.getByRole("spinbutton", {
        name: "Einstellungen: Sprungweite",
        exact: true,
      }),
    ).toHaveValue("7");
    await page.setViewportSize({ width: 1000, height: 680 });
    await choose(page, "Design", "Dunkle Darstellung");
    const done = page.getByRole("button", { name: "Fertig", exact: true });
    await expect(done).toBeInViewport();
    await page.screenshot({
      path: "test-results/settings-german-dark-compact.png",
      animations: "disabled",
    });
    await choose(page, "App-Sprache", "English");
    await expect(
      page.getByRole("dialog", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect(await readFile(join(profile, "language.json"), "utf8")).toBe(
      '{"language":"en"}',
    );
    const enLabels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.map((item) => item.label),
    );
    expect(enLabels).toContain("File");
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

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { tourSteps } from "../../src/WelcomeTour";

test("light workspace and welcome tour are complete, keyboard accessible and persistent", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "tacticut-appearance-"));
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      args: [resolve(".")],
      env: { ...process.env, TACTICUT_USER_DATA: dir },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("button", { name: "Add Source video", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Light appearance", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("heading", { name: "Start a project" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open project", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".toolbar")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(244, 246, 249)");
    await page.screenshot({
      animations: "disabled",
      path: "test-results/light-welcome.png",
    });
    await page.getByRole("button", { name: /Start welcome tour/ }).click();
    for (let i = 0; i < tourSteps.length; i++) {
      const dialog = page.getByRole("dialog", {
        name: tourSteps[i].title,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(page.locator(".tour-spotlight")).toBeVisible();
      expect(
        await page
          .locator(".workspace")
          .evaluate((el) => el.hasAttribute("inert")),
      ).toBe(true);
      const bounds = (await dialog.boundingBox())!;
      const viewport = page.viewportSize();
      if (viewport) {
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      if (i === 0 || i === 7)
        await page.screenshot({
          animations: "disabled",
          path: `test-results/light-tour-${i + 1}.png`,
        });
      if (i === 0) {
        await dialog.getByRole("button", { name: /Skip for now/ }).focus();
        await page.keyboard.press("Tab");
        await expect(
          dialog.getByRole("button", { name: "Close welcome tour" }),
        ).toBeFocused();
      }
      await dialog
        .getByRole("button", {
          name: i === tourSteps.length - 1 ? "Finish tour" : "Next",
          exact: true,
        })
        .click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("tacticut-tour-seen")),
    ).toBe("yes");
    await page
      .getByRole("button", { name: "Welcome tour", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Analysis actions", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Manage Categories", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect
      .poll(() =>
        page.getByRole("dialog").evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    await page.screenshot({
      animations: "disabled",
      path: "test-results/light-categories.png",
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await app.evaluate(({ app }) => app.exit(0));
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Welcome tour", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("button", { name: /Revisit welcome tour/ }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Dark appearance", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Open project", exact: true })
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe("rgb(37, 41, 47)");
    await page.screenshot({
      animations: "disabled",
      path: "test-results/dark-welcome.png",
    });
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

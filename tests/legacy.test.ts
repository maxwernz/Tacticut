import { it, expect } from "vitest";
import { readFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { importLegacy } from "../electron/legacy";
import { load, saveDocument, recoveryPayload } from "../electron/files";
const fixture = resolve("tests/fixtures/cup-final.analysis");
it("opens the original historical fixture with every Clip and Category intact", async () => {
  const a = importLegacy(await readFile(fixture), fixture);
  expect(a.title).toBe("cup-final");
  expect(a.source_videos[0].location).toBe("/fixtures/missing/cup-final.mp4");
  expect(a.categories.map((c) => c.name)).toEqual(["Angriff", "Abwehr"]);
  expect(a.clips.map((c) => [c.name, c.start_ms, c.end_ms, c.notes])).toEqual([
    ["Fast break", 1250, 4500, "Left wing finishes"],
    ["Defensive stop", 8000, 10250, ""],
    ["Transition", 12000, 13000, "Uncategorized"],
  ]);
  expect(
    a.clips.map(
      (c) => a.categories.find((t) => t.id === c.category_id)?.name || null,
    ),
  ).toEqual(["Angriff", "Abwehr", null]);
});
it("requires Save As, preserves the original bytes, and clears legacy status only after conversion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "va-legacy-test-"));
  try {
    const original = join(dir, "original.analysis");
    await copyFile(fixture, original);
    const imported = await load(original);
    expect(imported.legacyPath).toBe(original);
    expect(recoveryPayload(imported).legacyPath).toBe(original);
    await expect(saveDocument(imported, original)).rejects.toThrow(
      /new filename/,
    );
    const converted = await saveDocument(
      imported,
      join(dir, "converted.analysis"),
    );
    expect(converted.legacyPath).toBeUndefined();
    expect((await load(converted.path!)).analysis).toEqual(converted.analysis);
    expect(await readFile(original)).toEqual(await readFile(fixture));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects executable globals, reducers, persistent references, truncation, and trailing content", async () => {
  const original = await readFile(fixture);
  for (const data of [
    Buffer.from("\x80\x04cos\nsystem\n.", "binary"),
    Buffer.from("\x80\x04R.", "binary"),
    Buffer.from("\x80\x04P.", "binary"),
    original.subarray(0, -1),
    Buffer.concat([original, Buffer.from("extra")]),
    Buffer.from("\x80\x04\x95", "binary"),
  ])
    expect(() => importLegacy(data, fixture)).toThrow();
});

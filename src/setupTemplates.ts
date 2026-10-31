import { z } from "zod";
import {
  analysisSchema,
  categorySchema,
  categoryKey,
  categoryShortcut,
  normalizeName,
  type Analysis,
} from "./domain";
import { emptyRoster, rosterSchema, withRoster } from "./roster";

export const setupTemplateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    categories: z.array(categorySchema).max(200),
    roster: rosterSchema,
  })
  .superRefine((t, ctx) => {
    const result = analysisSchema.safeParse({
      id: t.id,
      title: "",
      source_videos: [],
      clips: [],
      categories: t.categories,
      roster: t.roster,
    });
    if (!result.success)
      ctx.addIssue({
        code: "custom",
        message: "Template categories or roster are invalid",
      });
  });
export type SetupTemplate = z.infer<typeof setupTemplateSchema>;
export const templateStorageKey = "tacticut-setup-templates-v1";
export function readSetupTemplates(): SetupTemplate[] {
  const raw = localStorage.getItem(templateStorageKey);
  return raw
    ? z.array(setupTemplateSchema).max(100).parse(JSON.parse(raw))
    : [];
}
export function writeSetupTemplates(templates: SetupTemplate[]) {
  const parsed = z.array(setupTemplateSchema).max(100).parse(templates);
  localStorage.setItem(templateStorageKey, JSON.stringify(parsed));
}
export function makeSetupTemplate(
  analysis: Analysis,
  name: string,
): SetupTemplate {
  return setupTemplateSchema.parse({
    id: crypto.randomUUID(),
    name,
    categories: analysis.categories,
    roster: analysis.roster || emptyRoster(),
  });
}
/** Add reusable setup while retaining categories referenced by existing clips. */
export function applySetupTemplate(
  analysis: Analysis,
  raw: SetupTemplate,
): Analysis {
  const template = setupTemplateSchema.parse(raw);
  const categories = analysis.categories.map((c) => ({
    ...c,
    shortcut: categoryShortcut(analysis.categories, c),
  }));
  for (const category of template.categories) {
    const match = categories.find(
      (c) => categoryKey(c) === categoryKey(category),
    );
    let shortcut = categoryShortcut(template.categories, category);
    if (categories.some((c) => c.id !== match?.id && c.shortcut === shortcut))
      shortcut = null;
    if (match) Object.assign(match, category, { id: match.id, shortcut });
    else categories.push({ ...category, id: crypto.randomUUID(), shortcut });
  }
  const roster = structuredClone(analysis.roster || emptyRoster());
  for (const team of template.roster.teams) {
    const existing = roster.teams.find((t) => t.id === team.id);
    if (existing) Object.assign(existing, team);
    else roster.teams.push(team);
  }
  for (const person of template.roster.players) {
    const existing = roster.players.find((p) => p.id === person.id);
    if (existing) Object.assign(existing, person);
    else roster.players.push(person);
  }
  return analysisSchema.parse(withRoster({ ...analysis, categories }, roster));
}
export function encodeSetupTemplate(template: SetupTemplate): string {
  return JSON.stringify(
    {
      format: "tacticut-setup",
      version: 1,
      template: setupTemplateSchema.parse(template),
    },
    null,
    2,
  );
}
export function decodeSetupTemplate(text: string): SetupTemplate {
  return z
    .object({
      format: z.literal("tacticut-setup"),
      version: z.literal(1),
      template: setupTemplateSchema,
    })
    .parse(JSON.parse(text)).template;
}

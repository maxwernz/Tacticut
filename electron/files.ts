import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  mkdir,
  stat,
  unlink,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  analysisSchema,
  decode,
  encode,
  type Analysis,
  type SourceVideo,
} from "../src/domain";
import type { Loaded } from "../src/api";
import { importLegacy } from "./legacy";

export async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx");
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export const digest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
function relativeMediaPath(
  documentPath: string,
  mediaPath: string,
): string | null {
  const path = relative(dirname(documentPath), mediaPath);
  // Different Windows drives cannot be represented as a portable relative path.
  return isAbsolute(path) ? null : path.replaceAll("\\", "/");
}
export async function load(path: string): Promise<Loaded> {
  const contents = await readFile(path);
  if (contents[0] === 0x80)
    return {
      analysis: importLegacy(contents, path),
      path,
      stamp: digest(contents),
      legacyPath: path,
    };
  return {
    analysis: decode(contents.toString("utf8")),
    path,
    stamp: digest(contents),
  };
}
export async function resolveSource(
  source: SourceVideo,
  documentPath: string | null,
): Promise<string> {
  const candidates = [source.location];
  if (documentPath && source.relative_path)
    candidates.push(
      resolve(
        dirname(documentPath),
        source.relative_path.replaceAll("\\", "/"),
      ),
    );
  for (const path of candidates)
    if (
      isAbsolute(path) &&
      (await stat(path)
        .then((s) => s.isFile())
        .catch(() => false))
    )
      return path;
  throw new Error(
    `Source video “${source.display_name}” is missing. Relink it in the Videos tab.`,
  );
}
export async function saveDocument(
  data: Loaded,
  path: string,
): Promise<Loaded> {
  if (data.legacyPath) {
    const normalized = async (p: string) => {
      const actual = await realpath(p).catch(() => resolve(p));
      return process.platform === "win32" ? actual.toLowerCase() : actual;
    };
    if ((await normalized(path)) === (await normalized(data.legacyPath)))
      throw new Error(
        "Save the converted Analysis under a new filename. The original legacy file must be preserved.",
      );
  }
  if (data.path === path && data.stamp) {
    const current = await readFile(path)
      .then(digest)
      .catch(() => null);
    if (current !== data.stamp)
      throw new Error(
        "This Analysis changed outside the app. Use Save As or reopen it to avoid overwriting those changes.",
      );
  }
  const analysis = structuredClone(analysisSchema.parse(data.analysis));
  for (const source of analysis.source_videos) {
    const actual = await resolveSource(source, data.path).catch(() => null);
    if (actual) source.relative_path = relativeMediaPath(path, actual);
    else if (data.path && source.relative_path)
      source.relative_path = relativeMediaPath(
        path,
        resolve(dirname(data.path), source.relative_path.replaceAll("\\", "/")),
      );
  }
  const contents = encode(analysis);
  await atomicWrite(path, contents);
  return { analysis, path, stamp: digest(contents) };
}
export async function fingerprint(
  path: string,
): Promise<{ byte_size: number; fingerprint: string }> {
  const byte_size = (await stat(path)).size;
  const hash = createHash("sha256").update(String(byte_size));
  const file = await open(path, "r");
  try {
    for (const fraction of [0, 0.5, 1]) {
      const buffer = Buffer.alloc(65536);
      const offset = Math.min(
        Math.floor(byte_size * fraction),
        Math.max(byte_size - 65536, 0),
      );
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return { byte_size, fingerprint: hash.digest("hex") };
}
export function recoveryPayload(value: unknown): Loaded {
  const data = value as Loaded;
  return {
    analysis: analysisSchema.parse(data.analysis),
    path: typeof data.path === "string" ? data.path : null,
    stamp: typeof data.stamp === "string" ? data.stamp : null,
    legacyPath: typeof data.legacyPath === "string" ? data.legacyPath : null,
  };
}

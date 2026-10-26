/**
 * Reading the GitHub release an update comes from. A release is tagged
 * `v<version>` and carries, for each kind of Mac, the zipped app
 * (`Tacticut-<version>-<arch>.zip`), for Windows its installer
 * (`Tacticut-<version>-<arch>-setup.exe`), and each archive's signature (`….sig`).
 */

export interface Release {
  version: string;
  /** What changed, as the release notes say it. */
  notes: string;
  /** The page a person can download the release from by hand. */
  page: string;
  /** The archive for this machine and its signature; null when the release has none for it. */
  archive: { url: string; signatureUrl: string } | null;
}

/** `1.2.3` or `v1.2.3` as numbers; null for anything else, pre-releases included. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function feedUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

/** How the archive for a machine ends its name. */
export function archiveSuffix(platform: string, arch: string): string {
  return platform === "win32" ? `-${arch}-setup.exe` : `-${arch}.zip`;
}

/** Read GitHub's description of a release. Null when it is not one this app can use. */
export function readRelease(
  json: unknown,
  arch: string,
  platform: string,
): Release | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const parsed =
    typeof r.tag_name === "string" ? parseVersion(r.tag_name) : null;
  if (!parsed) return null;

  const assets = (Array.isArray(r.assets) ? r.assets : []).flatMap((a) => {
    const asset = a as Record<string, unknown> | null;
    const name = asset?.name;
    const url = asset?.browser_download_url;
    return typeof name === "string" && typeof url === "string"
      ? [{ name, url }]
      : [];
  });
  const archive = assets.find((a) =>
    a.name.endsWith(archiveSuffix(platform, arch)),
  );
  const signature =
    archive && assets.find((a) => a.name === `${archive.name}.sig`);

  return {
    version: parsed.join("."),
    notes: typeof r.body === "string" ? r.body : "",
    page: typeof r.html_url === "string" ? r.html_url : "",
    archive:
      archive && signature
        ? { url: archive.url, signatureUrl: signature.url }
        : null,
  };
}

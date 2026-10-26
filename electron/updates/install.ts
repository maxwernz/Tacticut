import { basename, dirname, join } from "node:path";

/**
 * Putting a new build where the running one is. An app cannot replace itself
 * while it runs. On a Mac the new bundle is staged beside the old one, and a
 * small script swaps them once the app has quit. On Windows the new build's
 * installer runs after the app quits and installs over it.
 */

/** `/Applications/Tacticut.app/Contents/MacOS/Tacticut` → `/Applications/Tacticut.app`. */
export function bundleOf(exePath: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return m ? m[1] : null;
}

export type Installable =
  /** A Mac app bundle, swapped for the new one. */
  | { ok: true; kind: "bundle"; bundle: string }
  /** A Windows install, updated by the new build's installer. */
  | { ok: true; kind: "installer" }
  /** Why this copy cannot replace itself; the user is offered the download instead. */
  | {
      ok: false;
      reason:
        | "unsupported-platform"
        | "not-installed"
        | "run-from-download"
        | "no-permission";
    };

export function installable(here: {
  platform: string;
  isPackaged: boolean;
  exePath: string;
  writable: (dir: string) => boolean;
}): Installable {
  if (here.platform === "win32")
    return here.isPackaged
      ? { ok: true, kind: "installer" }
      : { ok: false, reason: "not-installed" };
  if (here.platform !== "darwin")
    return { ok: false, reason: "unsupported-platform" };
  const bundle = here.isPackaged ? bundleOf(here.exePath) : null;
  if (!bundle) return { ok: false, reason: "not-installed" };
  // Opened straight from the disk image, or moved aside by macOS because it came
  // from the internet: either way it runs from somewhere read-only or temporary.
  if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/"))
    return { ok: false, reason: "run-from-download" };
  if (!here.writable(dirname(bundle)) || !here.writable(bundle))
    return { ok: false, reason: "no-permission" };
  return { ok: true, kind: "bundle", bundle };
}

/** Where the new bundle is unpacked: beside the old one, so swapping them is a rename. */
export function stagingDir(bundle: string, id: string): string {
  return join(dirname(bundle), `${stagingPrefix(bundle)}${id}`);
}

/** The name every staging folder of this bundle starts with, for cleaning up leftovers. */
export function stagingPrefix(bundle: string): string {
  return `.${basename(bundle, ".app")}-update-`;
}

/**
 * The script that finishes a Mac update:
 * `sh -c SWAP sh <pid> <bundle> <staged bundle> <relaunch 1|0>`.
 * It waits for the app to quit, moves the old bundle aside, moves the new one
 * in, and puts the old one back if that fails, so there is always an app there.
 */
export const SWAP = `
pid="$1"; bundle="$2"; staged="$3"; relaunch="$4"; old="$bundle.previous"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
rm -rf "$old"
if mv "$bundle" "$old"; then
  if mv "$staged" "$bundle"; then rm -rf "$old"; else mv "$old" "$bundle"; fi
fi
rm -rf "$(dirname "$staged")"
/usr/bin/xattr -dr com.apple.quarantine "$bundle" 2>/dev/null
if [ "$relaunch" = "1" ]; then /usr/bin/open "$bundle"; fi
`;

/**
 * How the Windows installer runs for an update: silently (`/S`), as an update
 * of the existing install (`--updated`), and, when asked, starting the app
 * again afterwards (`--force-run`).
 */
export function installerArgs(relaunch: boolean): string[] {
  return relaunch ? ["/S", "--updated", "--force-run"] : ["/S", "--updated"];
}

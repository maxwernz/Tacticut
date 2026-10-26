import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveSuffix,
  isNewer,
  parseVersion,
  readRelease,
} from "../electron/updates/feed";
import {
  SWAP,
  bundleOf,
  installable,
  installerArgs,
  stagingDir,
} from "../electron/updates/install";
import { signArchive, verifyArchive } from "../electron/updates/signature";

const scratch = () => mkdtempSync(join(tmpdir(), "tacticut-updates-"));

describe("a published release", () => {
  const github = (over: Record<string, unknown> = {}) => ({
    tag_name: "v0.4.0",
    body: "Faster exports.",
    html_url: "https://github.com/maxwernz/Tacticut/releases/tag/v0.4.0",
    assets: [
      "Tacticut-0.4.0-x64-setup.exe",
      "Tacticut-0.4.0-x64-setup.exe.sig",
      "Tacticut-0.4.0-arm64.zip",
      "Tacticut-0.4.0-arm64.zip.sig",
      "Tacticut-0.4.0-arm64.dmg",
    ].map((name) => ({
      name,
      browser_download_url: `https://example.test/${name}`,
    })),
    ...over,
  });

  it("is newer only when its version is higher", () => {
    expect(isNewer("0.4.0", "0.3.0")).toBe(true);
    expect(isNewer("v0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  });

  it("is never newer when a version cannot be read", () => {
    expect(parseVersion("0.4.0-beta.1")).toBeNull();
    expect(isNewer("0.4.0-beta.1", "0.3.0")).toBe(false);
    expect(isNewer("latest", "0.3.0")).toBe(false);
  });

  it("offers the zip built for this Mac, with its signature", () => {
    expect(readRelease(github(), "arm64", "darwin")).toEqual({
      version: "0.4.0",
      notes: "Faster exports.",
      page: "https://github.com/maxwernz/Tacticut/releases/tag/v0.4.0",
      archive: {
        url: "https://example.test/Tacticut-0.4.0-arm64.zip",
        signatureUrl: "https://example.test/Tacticut-0.4.0-arm64.zip.sig",
      },
    });
  });

  it("offers Windows its installer, and never the installer to a Mac", () => {
    expect(readRelease(github(), "x64", "win32")?.archive?.url).toBe(
      "https://example.test/Tacticut-0.4.0-x64-setup.exe",
    );
    expect(readRelease(github(), "x64", "darwin")?.archive).toBeNull();
    expect("Tacticut-0.4.0" + archiveSuffix("win32", "x64")).not.toMatch(
      /-x64\.zip$/,
    );
  });

  it("has nothing to install without a signature", () => {
    const unsigned = github({
      assets: [
        {
          name: "Tacticut-0.4.0-arm64.zip",
          browser_download_url: "https://example.test/a.zip",
        },
      ],
    });
    expect(readRelease(unsigned, "arm64", "darwin")?.archive).toBeNull();
  });

  it("is passed over while a draft or pre-release, or when it is not a release", () => {
    expect(readRelease(github({ draft: true }), "arm64", "darwin")).toBeNull();
    expect(
      readRelease(github({ prerelease: true }), "arm64", "darwin"),
    ).toBeNull();
    expect(readRelease({ message: "Not Found" }, "arm64", "darwin")).toBeNull();
    expect(readRelease(null, "arm64", "darwin")).toBeNull();
  });
});

describe("the signature of an archive", () => {
  const keys = () => {
    const pair = generateKeyPairSync("ed25519");
    return {
      secret: pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      open: pair.publicKey.export({ type: "spki", format: "pem" }) as string,
    };
  };
  const archive = (content: string) => {
    const file = join(scratch(), "update.zip");
    writeFileSync(file, content);
    return file;
  };

  it("holds for the archive the publisher signed", async () => {
    const { secret, open } = keys();
    const file = archive("the new build");
    expect(await verifyArchive(file, await signArchive(file, secret), open)).toBe(
      true,
    );
  });

  it("fails for an archive that was changed, however little", async () => {
    const { secret, open } = keys();
    const signature = await signArchive(archive("the new build"), secret);
    expect(await verifyArchive(archive("the new build."), signature, open)).toBe(
      false,
    );
  });

  it("fails for someone else's signature, including against the app's own key", async () => {
    const mine = keys();
    const theirs = keys();
    const file = archive("the new build");
    const signature = await signArchive(file, theirs.secret);
    expect(await verifyArchive(file, signature, mine.open)).toBe(false);
    expect(await verifyArchive(file, signature)).toBe(false);
  });

  it("fails rather than throws for a signature that is not one", async () => {
    const file = archive("the new build");
    for (const junk of ["", "not base64 at all", "<html>Not Found</html>"])
      expect(await verifyArchive(file, junk, keys().open)).toBe(false);
  });
});

describe("a copy of the app", () => {
  const here = (
    exePath: string,
    over: Partial<Parameters<typeof installable>[0]> = {},
  ) =>
    installable({
      platform: "darwin",
      isPackaged: true,
      exePath,
      writable: () => true,
      ...over,
    });
  const exe = "/Applications/Tacticut.app/Contents/MacOS/Tacticut";

  it("knows the bundle it runs from", () => {
    expect(bundleOf(exe)).toBe("/Applications/Tacticut.app");
    expect(bundleOf("/usr/local/bin/electron")).toBeNull();
  });

  it("can replace itself when installed where it may write", () => {
    expect(here(exe)).toEqual({
      ok: true,
      kind: "bundle",
      bundle: "/Applications/Tacticut.app",
    });
  });

  it("cannot when it runs from the disk image or a translocated download", () => {
    expect(here("/Volumes/Tacticut/Tacticut.app/Contents/MacOS/Tacticut")).toEqual(
      { ok: false, reason: "run-from-download" },
    );
    expect(
      here(
        "/private/var/folders/ab/T/AppTranslocation/1F2E/d/Tacticut.app/Contents/MacOS/Tacticut",
      ),
    ).toEqual({ ok: false, reason: "run-from-download" });
  });

  it("cannot without write access, in development, or on another system", () => {
    expect(here(exe, { writable: () => false })).toEqual({
      ok: false,
      reason: "no-permission",
    });
    expect(
      here(
        "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        { isPackaged: false },
      ),
    ).toEqual({ ok: false, reason: "not-installed" });
    expect(here("/opt/Tacticut/tacticut", { platform: "linux" })).toEqual({
      ok: false,
      reason: "unsupported-platform",
    });
  });

  it("on Windows, updates through the installer, relaunching only when asked", () => {
    expect(
      here("C:\\Program Files\\Tacticut\\Tacticut.exe", { platform: "win32" }),
    ).toEqual({ ok: true, kind: "installer" });
    expect(installerArgs(true)).toContain("--force-run");
    expect(installerArgs(false)).not.toContain("--force-run");
  });

  it("unpacks an update beside itself, so swapping is a rename", () => {
    expect(stagingDir("/Applications/Tacticut.app", "9f3a")).toBe(
      "/Applications/.Tacticut-update-9f3a",
    );
  });
});

describe.runIf(process.platform === "darwin")(
  "swapping the bundles once the app has quit",
  () => {
    /** A folder standing in for /Applications: the old bundle, and the new one staged beside it. */
    function installed() {
      const apps = scratch();
      const bundle = join(apps, "Tacticut.app");
      const stage = stagingDir(bundle, "test");
      const staged = join(stage, "Tacticut.app");
      for (const [dir, version] of [
        [bundle, "old"],
        [staged, "new"],
      ] as const) {
        mkdirSync(join(dir, "Contents"), { recursive: true });
        writeFileSync(join(dir, "Contents", "version"), version);
      }
      return { bundle, stage, staged };
    }
    const version = (bundle: string) =>
      readFileSync(join(bundle, "Contents", "version"), "utf8");

    // Relaunch is "0" throughout: the stand-in is no real app and must not be opened.
    it("waits for the app, then leaves the new build in place and nothing else behind", async () => {
      const { bundle, stage, staged } = installed();
      const running = spawn("/bin/sleep", ["0.6"]);
      const done = new Promise((r) =>
        spawn("/bin/sh", [
          "-c",
          SWAP,
          "sh",
          String(running.pid),
          bundle,
          staged,
          "0",
        ]).on("exit", r),
      );

      await new Promise((r) => setTimeout(r, 250));
      expect(version(bundle)).toBe("old"); // the app is still running

      await done;
      expect(version(bundle)).toBe("new");
      expect(existsSync(stage)).toBe(false);
      expect(existsSync(`${bundle}.previous`)).toBe(false);
    });

    it("puts the old build back when the new one cannot be moved in", () => {
      const { bundle, stage } = installed();
      execFileSync(
        "/bin/sh",
        ["-c", SWAP, "sh", "999999", bundle, join(stage, "Missing.app"), "0"],
        { stdio: "ignore" },
      );
      expect(version(bundle)).toBe("old");
      expect(existsSync(`${bundle}.previous`)).toBe(false);
    });
  },
);

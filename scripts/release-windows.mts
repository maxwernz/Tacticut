/**
 * Add the Windows installer to a release published with `npm run release`.
 *
 *   npm run release:windows              wait for CI on the release commit, sign its installer, attach it
 *   npm run release:windows -- --dry-run download and sign only; nothing is uploaded
 *
 * Windows builds need Windows, so GitHub Actions builds the installer
 * (`.github/workflows/desktop.yml`). This script takes the installer from the
 * CI run of the exact commit the release is tagged on, signs it with the same
 * update key as the Mac build, and uploads it with its `.sig`. Installed
 * Windows copies then update to it like Mac copies do.
 *
 * Needs Node 23.6+ and `gh` logged in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { signArchive, verifyArchive } from "../electron/updates/signature.ts";

const REPO = "maxwernz/Tacticut";
const WORKFLOW = "desktop.yml";
const ARTIFACT = "tacticut-windows-2022";
const dryRun = process.argv.includes("--dry-run");

const root = resolve(import.meta.dirname, "..");
const { version, build } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { version: string; build: { productName: string } };
const tag = `v${version}`;
const installer = `${build.productName}-${version}-x64-setup.exe`;
const read = (cmd: string, argv: string[]) =>
  execFileSync(cmd, argv, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd: string, argv: string[]) =>
  execFileSync(cmd, argv, { cwd: root, stdio: "inherit" });
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const keyFile =
  process.env.TACTICUT_UPDATE_SIGNING_KEY ??
  join(homedir(), ".config/tacticut/update-signing-key.pem");
if (!existsSync(keyFile))
  fail(`No signing key at ${keyFile}. Without it installed copies would refuse the update.`);

// The commit the release is tagged on, so the installer matches the Mac build.
run("git", ["fetch", "--quiet", "--tags", "origin"]);
let commit = "";
try {
  commit = read("git", ["rev-list", "-n", "1", tag]);
} catch {
  fail(`There is no ${tag} release yet. Publish it with npm run release first.`);
}

const runs = () =>
  JSON.parse(
    read("gh", [
      "run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--commit", commit,
      "--json", "databaseId,status,conclusion", "--limit", "20",
    ]),
  ) as { databaseId: number; status: string; conclusion: string }[];

let found = runs();
if (found.length === 0) {
  console.log(`Starting the ${WORKFLOW} build for ${tag}…`);
  run("gh", ["workflow", "run", WORKFLOW, "--repo", REPO, "--ref", tag]);
  for (let i = 0; i < 30 && found.length === 0; i++) {
    await new Promise((done) => setTimeout(done, 2000));
    found = runs();
  }
  if (found.length === 0) fail("The CI build did not start. Check GitHub Actions.");
}
let id = found.find((r) => r.conclusion === "success")?.databaseId;
if (!id) {
  const pending = found.find((r) => r.status !== "completed");
  if (!pending)
    fail(`Every CI build of ${tag} failed. See https://github.com/${REPO}/actions`);
  console.log(`Waiting for CI build ${pending!.databaseId} (Windows tests and installer)…`);
  try {
    run("gh", ["run", "watch", String(pending!.databaseId), "--repo", REPO, "--exit-status", "--interval", "30"]);
  } catch {
    fail(`The CI build failed. See https://github.com/${REPO}/actions/runs/${pending!.databaseId}`);
  }
  id = pending!.databaseId;
}

const dir = join(root, "release", `windows-${version}`);
rmSync(dir, { recursive: true, force: true });
run("gh", ["run", "download", String(id), "--repo", REPO, "--name", ARTIFACT, "--dir", dir]);
const file = join(dir, installer);
if (!existsSync(file))
  fail(`CI built ${readdirSync(dir).join(", ") || "nothing"}, not ${installer}.`);

const signature = await signArchive(file, readFileSync(keyFile, "utf8"));
if (!(await verifyArchive(file, signature)))
  fail(`${keyFile} is not the key the app checks updates against.`);
writeFileSync(`${file}.sig`, signature);
console.log(`signed ${installer}`);

if (dryRun) {
  console.log(`Dry run: ${file} and its .sig are ready, nothing uploaded.`);
} else {
  run("gh", ["release", "upload", tag, "--repo", REPO, "--clobber", file, `${file}.sig`]);
  console.log(`Added Windows to ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
}

/**
 * Publish a build that installed copies of Tacticut update to.
 *
 *   npm run release                  test, build, sign and publish the version in package.json
 *   npm run release -- --notes "…"   what changed, shown in the update card in the app
 *   npm run release -- --dry-run     build and sign only; nothing leaves this machine
 *
 * Bump `version` in package.json, commit and push first: installed copies only
 * take a higher version, and the release is tagged on the pushed commit. The
 * zip is signed with the key in TACTICUT_UPDATE_SIGNING_KEY (default
 * ~/.config/tacticut/update-signing-key.pem). Installed copies refuse an update
 * that is not, so that key must never be lost or shared.
 *
 * Needs Node 23.6+ (runs TypeScript directly), an Apple Silicon Mac, and `gh` logged in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isNewer } from "../electron/updates/feed.ts";
import { signArchive, verifyArchive } from "../electron/updates/signature.ts";

const REPO = "maxwernz/Tacticut";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notes = args.includes("--notes")
  ? (args[args.indexOf("--notes") + 1] ?? "")
  : "";

const root = resolve(import.meta.dirname, "..");
const { version, build } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { version: string; build: { productName: string } };
const name = build.productName;
const tag = `v${version}`;
const run = (cmd: string, argv: string[]) =>
  execFileSync(cmd, argv, { cwd: root, stdio: "inherit" });
const read = (cmd: string, argv: string[]) =>
  execFileSync(cmd, argv, { cwd: root, encoding: "utf8" }).trim();
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (process.platform !== "darwin" || process.arch !== "arm64")
  fail("Releases are built on an Apple Silicon Mac.");
const keyFile =
  process.env.TACTICUT_UPDATE_SIGNING_KEY ??
  join(homedir(), ".config/tacticut/update-signing-key.pem");
if (!existsSync(keyFile))
  fail(`No signing key at ${keyFile}. Without it installed copies would refuse the update.`);
const key = readFileSync(keyFile, "utf8");

let commit = "";
if (!dryRun) {
  if (read("git", ["status", "--porcelain"]) !== "")
    fail("Commit your changes first: a release is built from a committed state.");
  run("git", ["fetch", "--quiet", "origin"]);
  commit = read("git", ["rev-parse", "HEAD"]);
  const branch = read("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const upstream = read("git", ["rev-parse", `origin/${branch}`]);
  if (commit !== upstream)
    fail(`Push ${branch} first: the release is tagged on the commit GitHub has.`);
  let latest: string | null = null;
  try {
    latest = read("gh", ["release", "view", "--repo", REPO, "--json", "tagName", "--jq", ".tagName"]);
  } catch {
    /* no release yet */
  }
  if (latest && !isNewer(version, latest))
    fail(`${tag} is not newer than the latest release ${latest}. Bump "version" in package.json.`);
}

run("npm", ["test"]);
run("npm", ["run", "build"]);
run("npx", ["electron-builder", "--mac", "--arm64", "--publish", "never"]);

const dist = join(root, "release");
const mine = (file: string) => file.startsWith(`${name}-${version}-`);
const zips = readdirSync(dist).filter((f) => mine(f) && f.endsWith(".zip"));
if (zips.length === 0) fail(`The build left no ${name}-${version}-*.zip in ${dist}.`);
for (const zip of zips) {
  const file = join(dist, zip);
  const signature = await signArchive(file, key);
  // Against the key the app carries: anything else would be refused by every installed copy.
  if (!(await verifyArchive(file, signature)))
    fail(`${keyFile} is not the key the app checks updates against.`);
  writeFileSync(`${file}.sig`, signature);
  console.log(`signed ${zip}`);
}

const files = readdirSync(dist)
  .filter((f) => mine(f) && /\.(zip|zip\.sig|dmg)$/.test(f))
  .map((f) => join(dist, f));
if (dryRun) {
  console.log(`Dry run: ${files.length} files ready in ${dist}, nothing published.`);
} else {
  const title = `${name} ${version}`;
  run("gh", [
    "release", "create", tag, "--repo", REPO, "--target", commit,
    "--title", title, "--notes", notes || title, ...files,
  ]);
  console.log(`Published ${title}: https://github.com/${REPO}/releases/tag/${tag}`);
}

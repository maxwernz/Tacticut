/**
 * electron-builder afterPack hook. Tacticut ships without an Apple developer
 * account, so the app is signed ad hoc: Apple Silicon refuses to run code with
 * no valid signature, and an ad-hoc one carries nobody's name.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};

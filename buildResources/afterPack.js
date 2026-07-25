const { execSync } = require('node:child_process');
const path = require('node:path');

// Strips extended attributes (resource forks / Finder info) from the packed app before electron-builder
// signs it — macOS codesign otherwise fails with "resource fork, Finder information, or similar detritus
// not allowed". Runs after packing, before signing. (Note: macOS 26+ adds an unremovable
// com.apple.provenance xattr that this can't clear; sign on macOS 14/15 or CI where that isn't present.)
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execSync(`xattr -cr ${JSON.stringify(appPath)}`, { stdio: 'inherit' });
};

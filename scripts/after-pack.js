'use strict';
/* ProGramerly - electron-builder afterPack hook
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Why: with no Developer ID certificate, electron-builder skips signing. But
   electron-builder has already rewritten Info.plist and the app's resources,
   which breaks the ad-hoc seal Electron ships with. On Apple Silicon an app
   whose seal is broken does not open at all - macOS says it "is damaged and
   can't be opened", and no right-click > Open gets past that. That was the
   Mac release that "did not work".

   So when no certificate is configured, the packed .app is ad-hoc signed
   ("-" identity) here, before the .dmg and .zip are made from it. With a
   real certificate this does nothing and electron-builder signs and
   notarises as usual. */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function which(bin) {
  try { execFileSync('/usr/bin/env', ['which', bin], { stdio: 'ignore' }); return true; } catch { return false; }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  • afterPack: a signing certificate is configured - electron-builder signs');
    return;
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const app = path.join(context.appOutDir, appName);
  if (!fs.existsSync(app)) { console.warn(`  • afterPack: ${app} not found - not signing`); return; }
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

  if (process.platform === 'darwin') {
    console.log(`  • afterPack: ad-hoc signing ${appName} (no Developer ID configured)`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
    return;
  }
  if (which('rcodesign')) {
    console.log(`  • afterPack: ad-hoc signing ${appName} with rcodesign`);
    execFileSync('rcodesign', ['sign', '--entitlements-xml-file', entitlements, app], { stdio: 'inherit' });
    return;
  }
  console.warn('  • afterPack: not on macOS and rcodesign is not installed - this .app is UNSIGNED and will not open on Apple Silicon');
};

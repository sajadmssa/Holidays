// ============================================================
//  scripts/build.js
//  Programmatic build script using electron-builder API
// ============================================================

'use strict';

// CRITICAL: Disable Electron's ASAR virtual filesystem hook so that
// electron-builder can write release/.../app.asar as a normal binary file.
process.noAsar = true;

const builder = require('electron-builder');
const Platform = builder.Platform;

console.log('🚀 Starting Windows production build (NSIS installer)...');

builder.build({
  targets: Platform.WINDOWS.createTarget(),
  config: {
    npmRebuild: false
  }
})
  .then((output) => {
    console.log('\n✅ Build completed successfully!');
    console.log('📦 Artifacts generated:\n', output.join('\n'));
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Build error:', err);
    process.exit(1);
  });

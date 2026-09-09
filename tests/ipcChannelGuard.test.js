// ============================================================
//  tests/ipcChannelGuard.test.js
//  Permanent Regression Guard:
//  Verifies that every IPC channel registered in Main Process
//  handlers is present in VALID_CHANNELS in preload.js, and vice-versa.
//
//  Fails with exit code 1 if any channel is missing or mismatched.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

console.log('🔍 [IPC Regression Guard] Auditing IPC channels between handlers and preload whitelist...\n');

// 1. Extract channels from preload.js
const preloadPath = path.join(__dirname, '../src/main/preload.js');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');

// Find VALID_CHANNELS = new Set([ ... ])
const match = preloadSource.match(/const\s+VALID_CHANNELS\s*=\s*new\s+Set\(\[\s*([\s\S]*?)\]\);/);
if (!match) {
  console.error('❌ FAIL: Could not locate VALID_CHANNELS in src/main/preload.js');
  process.exit(1);
}

const rawChannels = match[1];
const preloadChannels = new Set(
  [...rawChannels.matchAll(/['"`]([a-zA-Z0-9:_-]+)['"`]/g)].map(m => m[1])
);

console.log(`📋 Found ${preloadChannels.size} channels in preload.js VALID_CHANNELS.`);

// 2. Extract channels from all IPC handlers in src/main/ipc/ and src/main/main.js
const handlerDirs = [
  path.join(__dirname, '../src/main/ipc'),
];
const handlerFiles = [
  path.join(__dirname, '../src/main/main.js')
];

for (const dir of handlerDirs) {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      handlerFiles.push(path.join(dir, file));
    }
  }
}

const registeredChannels = new Map(); // channelName -> [file locations]

const handleRegex = /ipcMain\.(?:handle|on)\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g;

for (const filePath of handlerFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(path.join(__dirname, '..'), filePath);
  let m;
  while ((m = handleRegex.exec(content)) !== null) {
    const ch = m[1];
    if (!registeredChannels.has(ch)) {
      registeredChannels.set(ch, []);
    }
    registeredChannels.get(ch).push(relPath);
  }
}

console.log(`📋 Found ${registeredChannels.size} unique channels handled in Main Process across ${handlerFiles.length} files.\n`);

let hasFailure = false;

// 3. Check: Every registered handler must be in preload's VALID_CHANNELS
const missingInPreload = [];
for (const [channel, locations] of registeredChannels.entries()) {
  if (!preloadChannels.has(channel)) {
    missingInPreload.push({ channel, locations });
  }
}

if (missingInPreload.length > 0) {
  hasFailure = true;
  console.error(`❌ REGRESSION DETECTED: ${missingInPreload.length} channel(s) registered in handlers but MISSING from preload VALID_CHANNELS:`);
  for (const item of missingInPreload) {
    console.error(`   - "${item.channel}" (registered in: ${item.locations.join(', ')})`);
  }
  console.error('\n   Fix: Add these channels to VALID_CHANNELS in src/main/preload.js.\n');
} else {
  console.log('✅ PASS: All channels registered in Main handlers are present in preload VALID_CHANNELS.');
}

// 4. Check: Every channel in preload's VALID_CHANNELS should have a handler
const missingInHandlers = [];
for (const channel of preloadChannels) {
  if (!registeredChannels.has(channel)) {
    missingInHandlers.push(channel);
  }
}

if (missingInHandlers.length > 0) {
  hasFailure = true;
  console.error(`❌ DEAD CHANNELS DETECTED: ${missingInHandlers.length} channel(s) in preload VALID_CHANNELS with NO handler in Main:`);
  for (const channel of missingInHandlers) {
    console.error(`   - "${channel}"`);
  }
  console.error('\n   Fix: Either register the handler or remove the unused channel from preload.js.\n');
} else {
  console.log('✅ PASS: All channels in preload VALID_CHANNELS have active handlers in Main Process.');
}

// 5. Check: Every invoke('channel') in preload.js must be in VALID_CHANNELS
const invokeRegex = /invoke\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g;
const invokedInPreload = new Set();
let invMatch;
while ((invMatch = invokeRegex.exec(preloadSource)) !== null) {
  invokedInPreload.add(invMatch[1]);
}

const missingFromInvoked = [];
for (const ch of invokedInPreload) {
  if (!preloadChannels.has(ch)) {
    missingFromInvoked.push(ch);
  }
}

if (missingFromInvoked.length > 0) {
  hasFailure = true;
  console.error(`❌ INVOKE WITHOUT WHITELIST DETECTED: ${missingFromInvoked.length} channel(s) invoked in preload.js but NOT in VALID_CHANNELS:`);
  for (const ch of missingFromInvoked) {
    console.error(`   - "${ch}"`);
  }
  console.error('\n   Fix: Add these channels to VALID_CHANNELS in src/main/preload.js.\n');
} else {
  console.log(`✅ PASS: All ${invokedInPreload.size} channels called via invoke(...) in preload are whitelisted.`);
}

// 6. Final assertion
if (hasFailure) {
  console.error('\n💥 IPC Regression Guard FAILED! See details above.');
  process.exit(1);
} else {
  console.log(`\n🎉 PERFECT MATCH: All ${preloadChannels.size} IPC channels are 100% synchronized and protected against regression!`);
  process.exit(0);
}

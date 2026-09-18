// ============================================================
//  src/main/utils/pathValidator.js
//  Centralized Path Containment and Traversal / Zip Slip Protection
// ============================================================

'use strict';

const path = require('path');

/**
 * Resolves a relative path within a target root directory, strictly enforcing
 * path containment to prevent Path Traversal, Zip Slip, UNC path injection,
 * drive-letter hijacking, and sibling-folder prefix collision bypasses.
 *
 * @param {string} rootDir - The trusted base directory
 * @param {string} relativePath - The untrusted relative path or archive entry name
 * @returns {string} Safe resolved absolute path within rootDir
 * @throws {Error} If relativePath attempts to escape rootDir
 */
function resolveSafePathWithinRoot(rootDir, relativePath) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('المجلد الجذري غير صالح.');
  }

  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('مسار المستند غير صالح.');
  }

  // Reject null bytes, UNC paths, Windows drive letters, and explicit parent traversal ('..')
  if (
    relativePath.includes('\0') ||
    relativePath.startsWith('\\\\') ||
    relativePath.startsWith('//') ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.includes('..')
  ) {
    throw new Error('محاولة وصول غير مصرح بها للمسار (Path Traversal / Zip Slip Detected).');
  }

  const resolvedRoot = path.resolve(rootDir);
  const normalizedRel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const absolutePath = path.resolve(resolvedRoot, normalizedRel);

  // Enforce true folder boundary (path.sep / slash after root) to prevent sibling prefix bypass
  const normalizedRoot = resolvedRoot.replace(/\\/g, '/');
  const normalizedRootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
  const normalizedAbs = absolutePath.replace(/\\/g, '/');

  const relativeDiff = path.relative(resolvedRoot, absolutePath);
  const isOutside = relativeDiff.startsWith('..') || path.isAbsolute(relativeDiff);

  if (isOutside || (normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRootWithSep))) {
    throw new Error('المسار المطلوب يقع خارج المجلد المصرح به (Path Traversal / Zip Slip Detected).');
  }

  return absolutePath;
}

const { execSync } = require('child_process');

/**
 * Checks whether a given file/directory path points to a network location
 * (UNC share path \\server\share, //server/share, \\?\UNC\, or a Windows Mapped Network Drive).
 *
 * @param {string} targetPath - Path to inspect
 * @returns {boolean} True if network path, false if local
 */
function isNetworkPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;

  const rawPath = targetPath.trim();

  // 1. Raw UNC check before and after resolve (\\server\share, //server/share, \\?\UNC\server\share)
  if (
    rawPath.startsWith('\\\\') ||
    rawPath.startsWith('//') ||
    rawPath.toLowerCase().startsWith('\\\\?\\unc\\')
  ) {
    return true;
  }

  const resolved = path.resolve(rawPath);
  if (
    resolved.startsWith('\\\\') ||
    resolved.startsWith('//') ||
    resolved.toLowerCase().startsWith('\\\\?\\unc\\')
  ) {
    return true;
  }

  // 2. Windows Mapped Network Drive check (e.g. Z:\...)
  if (process.platform === 'win32') {
    const driveMatch = resolved.match(/^([a-zA-Z]:)/);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toUpperCase();
      try {
        // Query mapped network drives using net use
        const output = execSync('net use', {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
          timeout: 2000,
          windowsHide: true,
        });
        // Match drive letter followed by UNC path in net use output
        const driveRegex = new RegExp(`\\b${driveLetter}\\b.*\\\\\\\\[^\\s]+`, 'i');
        if (driveRegex.test(output)) {
          return true;
        }
      } catch (_) {
        // If net use fails or times out, proceed safely
      }
    }
  }

  return false;
}

module.exports = {
  resolveSafePathWithinRoot,
  isNetworkPath,
};

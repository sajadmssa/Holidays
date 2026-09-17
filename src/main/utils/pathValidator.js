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

module.exports = {
  resolveSafePathWithinRoot,
};

// This module is used by standard-version to read/write the VERSION constant in
// our .ts files.

const VERSION_PATTERN =
  /(?<=^export const VERSION = ")(\d+\.\d+\.\d+)(?="; \/\/ managed by standard-version, do not modify$)/m;

module.exports.readVersion = function (contents) {
  const match = VERSION_PATTERN.exec(contents);
  if (!match) {
    throw new Error(
      `Failed to find version, no match for pattern: ${VERSION_PATTERN}`,
    );
  }
  return match[0];
};

module.exports.writeVersion = function (contents, version) {
  // ensure contents has a match for the pattern
  if (module.exports.readVersion(contents) === version) {
    return contents;
  }
  return contents.replace(VERSION_PATTERN, version);
};

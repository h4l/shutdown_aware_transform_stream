// This module is used by standard-version to read/write the version in
// deno.land URLs referencing our module.

const IMPORT_URL_PATTERN =
  /(?<=\bhttps:\/\/deno.land\/x\/shutdown_aware_transform_stream@)([^/]+)(?=\/)/m;

module.exports.readVersion = function (contents) {
  const match = IMPORT_URL_PATTERN.exec(contents);
  if (!match) {
    throw new Error(
      `Failed to find version, no match for pattern: ${IMPORT_URL_PATTERN}`,
    );
  }
  return match[0];
};

module.exports.writeVersion = function (contents, version) {
  // ensure contents has a match for the pattern
  if (module.exports.readVersion(contents) === version) {
    return contents;
  }
  return contents.replace(IMPORT_URL_PATTERN, version);
};

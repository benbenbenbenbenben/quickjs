// Pure helper functions for the QuickJS browser debugger UI.
// These are imported by main.js and unit-tested with Vitest.

/**
 * Parse the top stack frame from an Error().stack string.
 * Returns { locationText, lineNumber } where lineNumber is 1-based
 * (or null if it can’t be determined).
 */
export function parseTopFrame(stackText, totalLines) {
  if (typeof stackText !== "string" || !stackText) {
    return {locationText: "(unknown)", lineNumber: null};
  }
  const lines = stackText.split("\n");
  const firstLine = (lines[1] || "").trim();
  if (!firstLine) {
    return {locationText: "(unknown)", lineNumber: null};
  }

  let lineNumber = null;
  const m = firstLine.match(/:(\d+)(?::\d+)?\)?\s*$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && (typeof totalLines !== "number" || n <= totalLines)) {
      lineNumber = n;
    }
  }

  return {locationText: firstLine, lineNumber};
}


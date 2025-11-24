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

/**
 * For a single-step operation: remove `debugger` statements from the
 * currently-paused line only.
 */
export function transformCodeForStep(source, currentLine) {
  if (typeof source !== "string" || !currentLine) return source;
  const lines = source.split("\n");
  if (currentLine < 1 || currentLine > lines.length) return source;
  lines[currentLine - 1] = lines[currentLine - 1].replace(/\bdebugger;?/g, "");
  return lines.join("\n");
}

/**
 * For a continue operation: strip all `debugger` statements from the source.
 */
export function transformCodeForContinue(source) {
  if (typeof source !== "string") return source;
  return source.replace(/\bdebugger;?/g, "");
}

// Polyfill crypto.getRandomValues for Node 16 so that
// Vite 5 (which expects it) can run inside the emscripten/emsdk image.

try {
  const crypto = require("node:crypto");

  if (crypto && typeof crypto.getRandomValues !== "function") {
    const wc = crypto.webcrypto || globalThis.crypto;

    if (wc && typeof wc.getRandomValues === "function") {
      crypto.getRandomValues = function (buffer) {
        return wc.getRandomValues(buffer);
      };
    } else if (typeof crypto.randomBytes === "function") {
      crypto.getRandomValues = function (buffer) {
        const bytes = crypto.randomBytes(buffer.length);
        if (buffer.set) {
          buffer.set(bytes);
        } else {
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = bytes[i];
          }
        }
        return buffer;
      };
    }
  }
} catch (e) {
  // Best-effort polyfill; ignore if anything goes wrong.
}

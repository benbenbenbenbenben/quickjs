import {describe, it, expect} from "vitest";
import {parseTopFrame} from "./debugger-logic.js";

describe("parseTopFrame", () => {
  it("extracts location and line from typical QuickJS stack", () => {
    const stack = [
      "Error",
      "    at fib (<input>:6:3)",
      "    at <anonymous> (<input>:10:1)",
    ].join("\n");
    const {locationText, lineNumber} = parseTopFrame(stack, 20);
    expect(locationText).toBe("at fib (<input>:6:3)");
    expect(lineNumber).toBe(6);
  });

  it("handles missing line gracefully", () => {
    const stack = "Error";
    const {locationText, lineNumber} = parseTopFrame(stack, 10);
    expect(locationText).toBe("(unknown)");
    expect(lineNumber).toBeNull();
  });

  it("returns null lineNumber when parsed line exceeds totalLines", () => {
    const stack = [
      "Error",
      "    at fib (<input>:100:3)",
    ].join("\n");
    const {locationText, lineNumber} = parseTopFrame(stack, 10);
    expect(locationText).toBe("at fib (<input>:100:3)");
    expect(lineNumber).toBeNull();
  });
});


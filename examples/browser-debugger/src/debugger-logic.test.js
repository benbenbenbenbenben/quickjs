import {describe, it, expect} from "vitest";
import {parseTopFrame, transformCodeForStep, transformCodeForContinue} from "./debugger-logic.js";

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

describe("transformCodeForStep", () => {
  const code = [
    "function f() {",
    "  debugger; // first", // line 2
    "  debugger; // second", // line 3
    "}",
  ].join("\n");

  it("removes debugger only on the current line", () => {
    const out = transformCodeForStep(code, 2);
    const lines = out.split("\n");
    expect(lines[1]).not.toMatch(/debugger/);
    expect(lines[2]).toMatch(/debugger/);
  });

  it("returns original code for out-of-range line", () => {
    expect(transformCodeForStep(code, 10)).toBe(code);
  });

  it("can be applied repeatedly to step through successive debugger lines", () => {
    let current = code;
    current = transformCodeForStep(current, 2);
    current = transformCodeForStep(current, 3);
    const lines = current.split("\n");
    expect(lines[1]).not.toMatch(/debugger/);
    expect(lines[2]).not.toMatch(/debugger/);
  });

  it("ignores falsy or non-positive currentLine values", () => {
    expect(transformCodeForStep(code, 0)).toBe(code);
    expect(transformCodeForStep(code, -1)).toBe(code);
    expect(transformCodeForStep(code, null)).toBe(code);
    expect(transformCodeForStep(code, undefined)).toBe(code);
  });
});

describe("transformCodeForContinue", () => {
  it("removes all debugger statements", () => {
    const src = "debugger;\nif (true) { debugger; }";
    const out = transformCodeForContinue(src);
    expect(out).not.toMatch(/debugger/);
  });

  it("preserves non-debugger code while stripping breakpoints", () => {
    const src = [
      "let x = 1;",
      "debugger;",
      "x++;",
      "if (x > 1) { debugger; console.log(x); }",
    ].join("\n");
    const out = transformCodeForContinue(src);
    expect(out).toContain("let x = 1;");
    expect(out).toContain("x++;");
    expect(out).toContain("console.log(x);");
    expect(out).not.toMatch(/debugger/);
  });
});

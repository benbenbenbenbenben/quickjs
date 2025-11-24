# QuickJS Debugger Support

This fork of QuickJS adds a minimal debugger hook and example tooling, with a focus on keeping the core engine close to upstream while exposing a simple way to react to `debugger;` statements from an embedding.

This document gives a high-level overview of:

- The engine-level debugger hook
- The browser / WebAssembly example
- How to build and run the debugger demos

For engine internals, start with `quickjs.c` and `quickjs.h`.

## Engine-level debugger hook

QuickJS already parses the `debugger;` statement as `TOK_DEBUGGER`. In this fork, that token is wired to an embedding-visible hook:

- When a `debugger;` statement executes, the engine calls a debugger callback.
- Embedders can install a handler that receives a text description of the current pause location and stack.

At a high level:

- `quickjs.c` adds/extends:
  - Handling of `TOK_DEBUGGER` in the bytecode interpreter.
  - A runtime field that stores debugger-related configuration (e.g. hooks and strip flags).
- `quickjs.h` exposes a small C API for embedders who want to install a handler:

  ```c
  typedef int JSDebuggerHandler(JSContext *ctx, void *opaque);

  void JS_SetDebuggerHandler(JSRuntime *rt,
                             JSDebuggerHandler *cb,
                             void *opaque);
  ```

  The handler is called whenever a `debugger;` statement executes. It receives the current `JSContext *` and your `opaque` pointer, and should return `0` to continue execution or a non-zero value to abort the current run with an internal error.

- The existing strip flags are respected when requested:
  - `JS_STRIP_DEBUG` can be used via `qjs`/`qjsc` to strip debugger metadata from compiled output if you don’t want debugger support.

See the usage example in `examples/wasm-debug/wasm_debug.c`.

## Native C API reference

This section summarizes the native debugger API for embedders, using the public declarations in `quickjs.h` and the reference implementation in `qjs.c`.

### API surface

```c
typedef int JSDebuggerHandler(JSContext *ctx, void *opaque);

void JS_SetDebuggerHandler(JSRuntime *rt,
                           JSDebuggerHandler *cb,
                           void *opaque);
```

- The handler is installed per-runtime via `JS_SetDebuggerHandler`.
- It is invoked synchronously from the bytecode interpreter whenever a `debugger;` statement executes.
- If the handler returns `0`, execution continues after the `debugger;`.
- If the handler returns non-zero, QuickJS throws an internal error and unwinds the current execution.

### Minimal usage example

```c
static int logging_debugger_handler(JSContext *ctx, void *opaque)
{
    (void)opaque;

    JSAtom name_atom = JS_GetScriptOrModuleName(ctx, 0);
    const char *name_str = JS_AtomToCString(ctx, name_atom);
    if (name_str) {
        fprintf(stderr, "[debugger] Breakpoint in %s\n", name_str);
        JS_FreeCString(ctx, name_str);
    } else {
        fprintf(stderr, "[debugger] Breakpoint\n");
    }
    JS_FreeAtom(ctx, name_atom);

    const char *src = "new Error().stack";
    JSValue val = JS_Eval(ctx, src, strlen(src), "<debugger>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(val)) {
        js_std_dump_error(ctx);
    } else {
        const char *stack = JS_ToCString(ctx, val);
        if (stack) {
            fprintf(stderr, "%s\n", stack);
            JS_FreeCString(ctx, stack);
        }
    }
    JS_FreeValue(ctx, val);

    return 0; /* always continue */
}

...

JSRuntime *rt = JS_NewRuntime();
JSContext *ctx = JS_NewContext(rt);

JS_SetDebuggerHandler(rt, logging_debugger_handler, NULL);
```

### Interactive CLI-style handler

The standalone interpreter in this fork (`qjs`) registers a more powerful handler, `qjs_debugger_handler` (`qjs.c:49`), which you can copy or adapt. It:

- Prints the script/module name and the top frame of `Error().stack` when a breakpoint hits.
- Enters a small read–eval–print loop on `stdin`:
  - `c` / `C` → continue execution
  - `q` / `Q` → abort the current script
  - `bt` → print a full JavaScript backtrace (`new Error().stack`)
  - `this` → print the current `this` value
  - `locals` → print own enumerable properties of `this`
  - any other input → evaluated as a JavaScript expression in the current context, with the result printed.

This is a convenient reference if you want to build a CLI tool with interactive debugging on top of the engine.

## Wasm embedding helper (`wasm_debug.c`)

The file `examples/wasm-debug/wasm_debug.c` demonstrates how to:

- Build QuickJS + debugger support to WebAssembly.
- Install a debugger handler that forwards a message back into JavaScript.

Conceptually it:

- Creates a `JSRuntime` / `JSContext`.
- Calls `JS_SetDebuggerHandler` (or a helper wrapper such as `qjs_install_debugger_handler`).
- When the debugger fires, uses an `EMSCRIPTEN_KEEPALIVE` callback to call back into the JS host with a string message.

The browser example’s README (`examples/browser-debugger/README.txt`) contains a concrete `emcc` command line that exports these helpers.

## Browser example

The `examples/browser-debugger/` directory contains a minimal browser UI that exercises the debugger hook.

Key files:

- `examples/browser-debugger/README.txt` – detailed description and build instructions.
- `examples/browser-debugger/public/quickjs-browser.js` / `.wasm` – built WebAssembly module (not tracked in git by default).
- `examples/browser-debugger/src/main.js` – sets up the CodeMirror editor and connects the debugger hook to the UI.
- `examples/browser-debugger/src/debugger-logic.js` – small, pure helper functions used by the UI.
- `examples/browser-debugger/tests-e2e/debugger.spec.ts` – Playwright end-to-end tests that drive the debugger UI.

### How the browser debugger works

1. The page hosts a CodeMirror 6 editor where you can type JavaScript. The default sample includes a `debugger;` line.
2. A WebAssembly-compiled QuickJS module is loaded as `window.QuickJSModule`.
3. When the wasm module is instantiated, it is given callback hooks:

   ```js
   const ModuleFactory = window.QuickJSModule;
   const mod = ModuleFactory({
     onQuickJSDebugBreak(msg) {
       // Called whenever the engine hits a debugger; statement.
     },
     onQuickJSError(msg) {
       // Error messages from QuickJS.
     },
     onQuickJSLog(msg) {
       // Console output from QuickJS.
     },
   });
   ```

4. In `main.js`, `onQuickJSDebugBreak` updates the UI:

   - It stores the latest stack string.
   - It uses `parseTopFrame(stackText, totalLines)` from `debugger-logic.js` to extract the top frame.
   - It highlights the current paused line in the editor.

5. The "Step" and "Continue" buttons are implemented in the UI by rewriting source:

   - `transformCodeForStep(source, currentLine)` removes `debugger;` from the current line only (a crude single-step).
   - `transformCodeForContinue(source)` removes all `debugger;` statements.

This is intentionally simple: it demonstrates that the engine can signal `debugger;` pauses to the host and that the host can respond (e.g. by changing source and re-running).

## Building and running the browser debugger

The browser example relies on:

- Emscripten (to compile QuickJS + `wasm_debug.c` to wasm)
- Node.js + npm (for the Vite dev server and tests)

The easiest way to get started is to use the provided container helper, which isolates all of this into a Docker/Podman image.

### Using the container helper (recommended)

From the repository root:

```bash
./examples/browser-debugger/build-in-container.sh
```

This will:

- Run an `emscripten/emsdk` container.
- Build `quickjs-browser.js` + `.wasm` into `examples/browser-debugger/public/`.
- Run `npm install` and `npm run build` inside the container.

You can customize the container runtime and image, for example:

```bash
CONTAINER_RUNTIME=podman \
QUICKJS_BROWSER_DEBUGGER_IMAGE=emscripten/emsdk:latest \
  ./examples/browser-debugger/build-in-container.sh
```

After the build, you can run the dev server on the host:

```bash
cd examples/browser-debugger
npm install
npm run start
```

Then open the printed URL (typically `http://localhost:5173/`) and try code containing `debugger;`.

### Building wasm manually

`examples/browser-debugger/README.txt` contains an example `emcc` command that demonstrates which symbols to export and how to wire the debugger handler. In short, you need to:

- Compile `quickjs.c`, `quickjs-libc.c`, `cutils.c`, `libunicode.c`, `libregexp.c`, `dtoa.c`, and `examples/wasm-debug/wasm_debug.c`.
- Export at least:

  - `JS_NewRuntime`, `JS_NewContext`, `JS_Eval`, `JS_IsException`, `JS_ToCString`, `JS_FreeCString`, `JS_FreeValue`, `js_std_dump_error`, `qjs_install_debugger_handler`.
  - Runtime methods such as `ccall`, `cwrap`, `UTF8ToString`.

- Build with `-s MODULARIZE=1 -s EXPORT_NAME=QuickJSModule` so that the loader matches `main.js`.

## Notes and limitations

- This is a **minimal** debugger hook, not a full protocol like Chrome DevTools.
- Stepping / continuing in the browser example is implemented by rewriting `debugger;` statements, not by pausing and resuming the same VM instance at the bytecode level.
- A production debugger would typically:
  - Keep a persistent runtime and context.
  - Implement stepping at the VM/bytecode level.
  - Expose a richer protocol (e.g. over a socket) for IDEs or remote tools.

This fork aims to stay close to upstream QuickJS while providing:

- A small, well-contained engine hook for `debugger;`.
- A reference WebAssembly + browser UI demonstrating how to embed and react to debugger breaks.

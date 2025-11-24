QuickJS browser debugger example
================================

This directory contains a small, self-contained browser example that uses:

  * QuickJS compiled to WebAssembly with Emscripten (see ../wasm-debug)
  * CodeMirror 6 for the editor
  * A minimal debugger UI wired to the engine-level debugger hook

The goal is to show how you might embed QuickJS in a web page, edit code,
run it, and receive `debugger;` breaks via the JSDebuggerHandler API.

Contents
--------

  * `index.html` – single-page app layout with a toolbar, CodeMirror
    editor area, and simple debugger / inspector panes.
  * `src/main.js` – frontend logic:
      - sets up CodeMirror 6 with JavaScript mode
      - lazily loads a QuickJS wasm module exposed as `window.QuickJSModule`
      - installs `Module.onQuickJSDebugBreak` to receive debugger breaks
      - evaluates the current editor contents inside QuickJS
      - provides a very small inspector that can evaluate expressions in
        the current context
  * `package.json` – a minimal Vite-based dev setup with CodeMirror 6.

Building QuickJS for the browser
--------------------------------

This example assumes you have built QuickJS as a WebAssembly module with
`examples/wasm-debug/wasm_debug.c` linked in, exporting at least:

  * `JS_NewRuntime`
  * `JS_NewContext`
  * `JS_Eval`
  * `JS_IsException`
  * `JS_ToCString`
  * `JS_FreeCString`
  * `JS_FreeValue`
  * `js_std_dump_error`
  * `qjs_install_debugger_handler`

and that the compiled loader is available as a global `QuickJSModule`
factory function.

A sketch (adjust paths / flags as needed):

   emcc \
     quickjs.c quickjs-libc.c cutils.c libunicode.c libregexp.c dtoa.c \
     examples/wasm-debug/wasm_debug.c \
     -s ENVIRONMENT=web \
     -s MODULARIZE=1 -s EXPORT_NAME=QuickJSModule \
      -s ASYNCIFY=1 \
      -s ASYNCIFY_STACK_SIZE=131072 \
      -s ASYNCIFY_IMPORTS='["js_debugger_break_async"]' \

      -s EXPORTED_FUNCTIONS='["_JS_NewRuntime","_JS_NewContext","_JS_Eval","_JS_IsException","_JS_ToCString","_JS_FreeCString","_JS_FreeValue","_js_std_dump_error","_qjs_install_debugger_handler"]' \

     -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString"]' \
     -o quickjs-browser.js


Then copy or serve `quickjs-browser.js` and `quickjs-browser.wasm` in a
way that `index.html` can reach them, and expose the factory as
`window.QuickJSModule` (for example by including the script and letting
it assign to `QuickJSModule`).

Building in a container (recommended)
-------------------------------------

If you prefer not to install Emscripten, Node.js and npm on the host,
you can use the provided container-based helper script. You only need
Docker or Podman.

From the repository root (`quickjs/`):

  ./examples/browser-debugger/build-in-container.sh

This will:

  * start an `emscripten/emsdk` container
  * build `quickjs-browser.js` into `examples/browser-debugger/public/`
  * run `npm install` and `npm run build` inside the container

You can change the container runtime and image via environment variables:

  CONTAINER_RUNTIME=podman \
  QUICKJS_BROWSER_DEBUGGER_IMAGE=emscripten/emsdk:latest \
    ./examples/browser-debugger/build-in-container.sh

Running the example locally
---------------------------

Once the wasm bundle exists in `public/` you can run the dev server on
your host machine (requires Node.js and npm):

  cd examples/browser-debugger
  npm install
  npm run start

Make sure `quickjs-browser.js` / `.wasm` are served (for example by
putting them in `examples/browser-debugger/public` or configuring Vite
accordingly) and that they set `window.QuickJSModule`.

Then open the dev server URL (typically http://localhost:5173/) in your
browser. Edit the JavaScript in the editor and press "Run". Any
`debugger;` statement will trigger the engine-level handler in
`wasm_debug.c`, which calls `Module.onQuickJSDebugBreakAsync(msg)`.
The QuickJS VM is paused at that bytecode using Asyncify until you
press "Step" or "Continue" in the UI. The example shows the stack,
a basic location string, and highlights the paused line in the editor.

Docker image
------------

You can also build a self-contained Docker image that serves the
pre-built app via nginx. From the repository root:

  docker build -t quickjs-browser-debugger \
    -f examples/browser-debugger/Dockerfile .

Then run it:

  docker run --rm -p 8080:80 quickjs-browser-debugger

and open http://localhost:8080/ in your browser.

Docker Compose
--------------

Alternatively, you can use Docker Compose from this directory:

  cd examples/browser-debugger
  docker compose up --build

Then open http://localhost:8080/ in your browser.

Continuous Integration artifacts
--------------------------------

On this fork's GitHub Actions CI, the `QuickJS wasm + browser debugger`
workflow job builds the wasm engine and front-end example using
`examples/browser-debugger/build-in-container.sh` and uploads the
results as a single artifact named `quickjs-browser-debugger-dist`.

From a successful CI run you can:

  * open the `QuickJS wasm + browser debugger` job,
  * download the `quickjs-browser-debugger-dist` artifact, and
  * unpack it locally to get the Vite build output under `dist/` plus
    the generated `quickjs-browser.js` / `.wasm` loader in
    `public/`.

Limitations
-----------

  * This example currently stops only at `debugger;` bytecodes; there is
    no general-purpose bytecode-level step-over/step-into/step-out or
    user-defined breakpoint table yet.
  * Error reporting is very basic and relies on `js_std_dump_error`,
    which currently writes to the console.
  * This example focuses on clarity over efficiency or robustness; for a
    production debugger you would want to add proper session management,
    error isolation, full stepping, breakpoints, and possibly source maps.


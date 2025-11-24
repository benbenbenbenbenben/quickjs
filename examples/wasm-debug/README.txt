QuickJS wasm debugging examples
===============================

This directory sketches how to use the engine‑level debugger hook
(`JS_SetDebuggerHandler`) when QuickJS is compiled to WebAssembly via
Emscripten. It focuses on two common hosts:

  * Node.js (wasm running under Node)
  * Browser (wasm running in a web page)

The core idea is the same in both cases:

  1. Build QuickJS as a wasm module with Emscripten.
  2. Install a `JSDebuggerHandler` on the runtime.
  3. In the handler, use `Error().stack` to get a backtrace and forward
     it to the JS host, which drives the actual debug UI.

Files
-----

  * `wasm_debug.c` — C glue that defines a simple `wasm_debugger_handler`
    and exports `qjs_install_debugger_handler(JSRuntime *rt)`.
    The handler is compiled into the wasm module and calls out to
    JavaScript via an Emscripten `EM_JS` function `js_debugger_break()`.

Node configuration (sketch)
---------------------------

A typical Node‑oriented Emscripten build might look like this (simplified):

  emcc \
    quickjs.c quickjs-libc.c cutils.c libunicode.c libregexp.c dtoa.c \
    examples/wasm-debug/wasm_debug.c \
    -s ENVIRONMENT=node \
    -s EXPORTED_FUNCTIONS='["_JS_NewRuntime","_JS_FreeRuntime","_qjs_install_debugger_handler"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -o quickjs-node.js

In Node you can then do something like:

  const Module = require('./quickjs-node.js');

  Module.onQuickJSDebugBreak = msg => {
    console.log('*** QuickJS debugger break ***');
    console.log(msg);
  };

  Module.onRuntimeInitialized = () => {
    const JS_NewRuntime = Module.cwrap('JS_NewRuntime', 'number', []);
    const qjs_install_debugger_handler = Module.cwrap(
      'qjs_install_debugger_handler', null, ['number']
    );

    const rt = JS_NewRuntime();
    qjs_install_debugger_handler(rt);

    // Create a context, evaluate scripts, etc. Any `debugger;`
    // statement will now trigger onQuickJSDebugBreak.
  };

Browser configuration (sketch)
------------------------------

For a browser‑oriented build you would change the Emscripten flags, e.g.:

  emcc \
    quickjs.c quickjs-libc.c cutils.c libunicode.c libregexp.c dtoa.c \
    examples/wasm-debug/wasm_debug.c \
    -s ENVIRONMENT=web \
    -s EXPORTED_FUNCTIONS='["_JS_NewRuntime","_JS_FreeRuntime","_qjs_install_debugger_handler"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -o quickjs-browser.js

Then in your web app:

  <script src="quickjs-browser.js"></script>
  <script>
  Module.onQuickJSDebugBreak = msg => {
    // Integrate with your UI instead of console.log
    console.log('*** QuickJS debugger break ***');
    console.log(msg);
  };

  Module.onRuntimeInitialized = () => {
    const JS_NewRuntime = Module.cwrap('JS_NewRuntime', 'number', []);
    const qjs_install_debugger_handler = Module.cwrap(
      'qjs_install_debugger_handler', null, ['number']
    );

    const rt = JS_NewRuntime();
    qjs_install_debugger_handler(rt);
    // Create a context, run scripts that contain `debugger;`, etc.
  };
  </script>

Notes
-----

  * The build commands above are sketches only; adjust source file list
    and flags to match your actual setup.
  * For browser use, this example keeps the handler simple: it logs the
    entire Error().stack string to the host. A more advanced debugger
    could parse that stack, correlate with source maps, or open a
    dedicated UI panel.
  * For Node, you can alternatively compile the full `qjs` executable to
    wasm and use `--debug` as in the native build, relying on stdin/stdout
    emulation. The `wasm_debug.c` approach is intended for embedding
    QuickJS as a library rather than using the stand‑alone CLI.
  * Nothing in this directory is used by the normal native build; these
    files are only examples for wasm/Emscripten usage.

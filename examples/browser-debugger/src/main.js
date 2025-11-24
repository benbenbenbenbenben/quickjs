import {EditorState, Compartment, StateEffect, StateField} from "@codemirror/state";
import {EditorView, Decoration} from "@codemirror/view";
import {javascript} from "@codemirror/lang-javascript";
import {parseTopFrame} from "./debugger-logic.js";

// Simple CodeMirror 6 setup
const language = new Compartment();
const editorParent = document.getElementById("editor");

const initialCode = `// QuickJS browser debugger example
// Use debugger; to pause execution

function fib(n) {
  if (n <= 1) return n;
  debugger; // breakpoint
  return fib(n - 1) + fib(n - 2);
}

console.log("fib(6) =", fib(6));
`;

const debugHighlightTheme = EditorView.baseTheme({
  ".cm-debugger-line": {
    backgroundColor: "rgba(255, 230, 150, 0.5)",
  },
});

const setDebugLineEffect = StateEffect.define();

const debugHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDebugLineEffect)) {
        const line = e.value;
        if (line == null) return Decoration.none;
        const lineHandle = tr.state.doc.line(line);
        return Decoration.set([
          Decoration.line({class: "cm-debugger-line"}).range(lineHandle.from),
        ]);
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const state = EditorState.create({
  doc: initialCode,
  extensions: [
    debugHighlightTheme,
    debugHighlightField,
    language.of(javascript()),
  ],
});

const view = new EditorView({
  state,
  parent: editorParent
});

// UI elements
const runBtn = document.getElementById("run");
const stepBtn = document.getElementById("step");
const contBtn = document.getElementById("cont");
const statusEl = document.getElementById("status");
const locationEl = document.getElementById("location");
const stackEl = document.getElementById("stack");
const consoleLog = document.getElementById("console-log");
const inspectInput = document.getElementById("inspect-input");
const inspectRun = document.getElementById("inspect-run");
const localsEl = document.getElementById("locals");

let qjsModulePromise = null;
let rtPtr = 0;
let ctxPtr = 0;
let paused = false;
let lastStack = "";
let currentDebugLine = null;
let currentDebugResolve = null;
let runInProgress = false;

function appendConsole(msg) {
  consoleLog.textContent += msg + "\n";
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

// Load the QuickJS wasm module. This assumes you built it as
// quickjs-browser.js/quickjs-browser.wasm and served it alongside this app.
function loadQuickJSModule() {
  if (qjsModulePromise) return qjsModulePromise;

  qjsModulePromise = new Promise((resolve, reject) => {
    if (!window.QuickJSModule) {
      reject(new Error("QuickJS wasm loader not found (QuickJSModule global)"));
      return;
    }
    const ModuleFactory = window.QuickJSModule;
    const mod = ModuleFactory({
      async onQuickJSDebugBreakAsync(msg) {
        paused = true;
        lastStack = msg;
        updateDebuggerFromStack(msg);
        stepBtn.disabled = false;
        contBtn.disabled = false;
        statusEl.textContent = "Paused at debugger;";
        return new Promise(resolveBreak => {
          currentDebugResolve = resolveBreak;
        });
      },
      onQuickJSError(msg) {
        appendConsole(msg);
      },
      onQuickJSLog(msg) {
        appendConsole(msg);
      },
    });
    mod.then(instance => {
      resolve(instance);
    }).catch(reject);
  });

  return qjsModulePromise;
}

function updateDebuggerFromStack(stack) {
  stackEl.textContent = stack;
  const { locationText, lineNumber } = parseTopFrame(stack, view.state.doc.lines);
  locationEl.textContent = locationText;
  currentDebugLine = lineNumber;
  view.dispatch({
    effects: setDebugLineEffect.of(lineNumber),
  });
}

function getQJS(Module) {
  return {
    JS_Eval: Module.cwrap("JS_Eval", "number", [
      "number", // ctx
      "string", // input
      "number", // len
      "string", // filename
      "number", // flags
    ]),
    qjs_is_exception: Module.cwrap("qjs_is_exception", "number", ["number"]),
    qjs_free_value: Module.cwrap("qjs_free_value", null, ["number", "number"]),
    qjs_dump_exception: Module.cwrap("qjs_dump_exception", null, ["number"]),
    qjs_to_cstring: Module.cwrap("qjs_to_cstring", "number", ["number", "number"]),
    qjs_free_cstring: Module.cwrap("qjs_free_cstring", null, ["number", "number"]),
  };
}

async function ensureRuntime() {
  const Module = await loadQuickJSModule();
  if (rtPtr) return {Module, rtPtr, ctxPtr};
 
  const JS_NewRuntime = Module.cwrap("JS_NewRuntime", "number", []);
  const JS_NewContext = Module.cwrap("JS_NewContext", "number", ["number"]);
  const qjs_install_debugger_handler = Module.cwrap(
    "qjs_install_debugger_handler",
    null,
    ["number"]
  );
 
  // qjs_install_console is only available in newer wasm builds. Fall back
  // to a pure-JS console shim when the native hook is missing so that
  // older quickjs-browser.js/wasm still work.
  const hasNativeConsole = typeof Module._qjs_install_console === "function";
  let qjs_install_console = null;
  if (hasNativeConsole) {
    qjs_install_console = Module.cwrap("qjs_install_console", null, ["number"]);
  }
 
  rtPtr = JS_NewRuntime();
  ctxPtr = JS_NewContext(rtPtr);
  qjs_install_debugger_handler(rtPtr);
  if (hasNativeConsole && qjs_install_console) {
    qjs_install_console(ctxPtr);
  }
 
  // Prepare helpers for later evaluations (run/inspect/log flush).
  const JS_Eval = Module.cwrap("JS_Eval", "number", [
    "number", // ctx
    "string", // input
    "number", // len
    "string", // filename
    "number", // flags
  ]);
  const qjs_is_exception = Module.cwrap("qjs_is_exception", "number", ["number"]);
  const qjs_free_value = Module.cwrap("qjs_free_value", null, ["number", "number"]);
  const qjs_dump_exception = Module.cwrap("qjs_dump_exception", null, ["number"]);
 
  const JS_EVAL_TYPE_GLOBAL = 0;
  const JS_EVAL_FLAG_STRICT = 1 << 3;
 
  // Ensure the log buffer exists; newer builds can stream logs via
  // js_console_log -> onQuickJSLog, but for older builds we also
  // install a JS-based console.log that pushes into __logs.
  const initSrc = hasNativeConsole ? `
    (function(){
      var g = (typeof globalThis !== 'undefined') ? globalThis : this;
      if (!g.__logs) g.__logs = [];
    })();
  ` : `
    (function(){
      var g = (typeof globalThis !== 'undefined') ? globalThis : this;
      if (!g.__logs) g.__logs = [];
      g.console = {
        log: function() {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) {
            try {
              parts.push(String(arguments[i]));
            } catch (e) {
              parts.push("<unprintable>");
            }
          }
          g.__logs.push(parts.join(" "));
        }
      };
    })();
  `;

  const initVal = JS_Eval(
    ctxPtr,
    initSrc,
    initSrc.length,
    "<init-console>",
    JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_STRICT
  );
  if (qjs_is_exception(initVal)) {
    qjs_dump_exception(ctxPtr);
  }
  qjs_free_value(ctxPtr, initVal);

  statusEl.textContent = "QuickJS ready";
  return {Module, rtPtr, ctxPtr};
}


async function runCurrentCode() {
  if (runInProgress) {
    return;
  }
  runInProgress = true;
  runBtn.disabled = true;

  const {Module, rtPtr, ctxPtr} = await ensureRuntime();
 
  // Always (re)install the debugger handler at the start of a run so
  // that a previous "Continue" only suppresses breaks for that run.
  const qjs_install_debugger_handler = Module.cwrap(
    "qjs_install_debugger_handler",
    null,
    ["number"],
  );
  qjs_install_debugger_handler(rtPtr);
 
  // clear previous state
  paused = false;
  lastStack = "";
  currentDebugLine = null;
  currentDebugResolve = null;
  stepBtn.disabled = true;
  contBtn.disabled = true;
  locationEl.textContent = "-";
  stackEl.textContent = "";
  localsEl.textContent = "";
  view.dispatch({effects: setDebugLineEffect.of(null)});
 
  const code = view.state.doc.toString();
 
  const JS_EVAL_TYPE_GLOBAL = 0;
  const JS_EVAL_FLAG_STRICT = 1 << 3;
 
  statusEl.textContent = "Running...";
  appendConsole("---- run ----");
 
  const evalResult = await Module.ccall(
    "JS_Eval",
    "number",
    ["number", "string", "number", "string", "number"],
    [ctxPtr, code, code.length, "<input>", JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_STRICT],
    {async: true},
  );

  const qjs_is_exception = Module.cwrap("qjs_is_exception", "number", ["number"]);
  const qjs_free_value = Module.cwrap("qjs_free_value", null, ["number", "number"]);
  const qjs_dump_exception = Module.cwrap("qjs_dump_exception", null, ["number"]);
  const qjs_to_cstring = Module.cwrap("qjs_to_cstring", "number", ["number", "number"]);
  const qjs_free_cstring = Module.cwrap("qjs_free_cstring", null, ["number", "number"]);

  if (qjs_is_exception(evalResult)) {
    qjs_dump_exception(ctxPtr);
    appendConsole("Uncaught exception");
  } else {
    appendConsole("Program finished");
  }
  qjs_free_value(ctxPtr, evalResult);

  // Pull buffered console.log output from the QuickJS context.
  const dumpLogsSrc = `
    (function(){
      var g = (typeof globalThis !== 'undefined') ? globalThis : this;
      if (!g.__logs || !g.__logs.length) return "";
      var out = "";
      for (var i = 0; i < g.__logs.length; i++) {
        if (i) out += "\n";
        out += String(g.__logs[i]);
      }
      g.__logs = [];
      return out;
    })();
  `;

  const logsVal = await Module.ccall(
    "JS_Eval",
    "number",
    ["number", "string", "number", "string", "number"],
    [ctxPtr, dumpLogsSrc, dumpLogsSrc.length, "<dump-logs>", JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_STRICT],
    {async: true},
  );

  if (!qjs_is_exception(logsVal)) {
    const cstrPtr = qjs_to_cstring(ctxPtr, logsVal);
    if (cstrPtr) {
      const text = Module.UTF8ToString(cstrPtr);
      qjs_free_cstring(ctxPtr, cstrPtr);
      if (text) {
        const lines = text.split("\n");
        for (const line of lines) {
          if (line) appendConsole(line);
        }
      }
    }
  } else {
    qjs_dump_exception(ctxPtr);
  }
  qjs_free_value(ctxPtr, logsVal);

  if (!paused) {
    statusEl.textContent = "Finished";
  }

  runInProgress = false;
  runBtn.disabled = false;
}

runBtn.addEventListener("click", () => {
  runCurrentCode().catch(err => {
    console.error(err);
    statusEl.textContent = "Error: " + err.message;
  });
});

stepBtn.addEventListener("click", () => {
  if (!paused || !currentDebugResolve) return;
  paused = false;
  stepBtn.disabled = true;
  contBtn.disabled = true;
  statusEl.textContent = "Stepping...";
  const resolve = currentDebugResolve;
  currentDebugResolve = null;
  resolve({ action: "step" });
});

contBtn.addEventListener("click", () => {
  if (!paused || !currentDebugResolve) return;
  paused = false;
  stepBtn.disabled = true;
  contBtn.disabled = true;
  statusEl.textContent = "Continuing";
  const resolve = currentDebugResolve;
  currentDebugResolve = null;
  resolve({ action: "continue" });
});

inspectRun.addEventListener("click", async () => {
  const expr = inspectInput.value.trim();
  if (!expr) return;

  const {Module} = await ensureRuntime();
  const JS_Eval = Module.cwrap("JS_Eval", "number", ["number", "string", "number", "string", "number"]);
  const qjs_is_exception = Module.cwrap("qjs_is_exception", "number", ["number"]);
  const qjs_to_cstring = Module.cwrap("qjs_to_cstring", "number", ["number", "number"]);
  const qjs_free_cstring = Module.cwrap("qjs_free_cstring", null, ["number", "number"]);
  const qjs_free_value = Module.cwrap("qjs_free_value", null, ["number", "number"]);
  const qjs_dump_exception = Module.cwrap("qjs_dump_exception", null, ["number"]);

  const JS_EVAL_TYPE_GLOBAL = 0;
  const JS_EVAL_FLAG_STRICT = 1 << 3;

  const val = JS_Eval(ctxPtr, expr, expr.length, "<inspect>", JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_STRICT);
  if (qjs_is_exception(val)) {
    qjs_dump_exception(ctxPtr);
    localsEl.textContent = "<exception>";
  } else {
    const cstrPtr = qjs_to_cstring(ctxPtr, val);
    if (cstrPtr) {
      const s = Module.UTF8ToString(cstrPtr);
      localsEl.textContent = s;
      qjs_free_cstring(ctxPtr, cstrPtr);
    } else {
      localsEl.textContent = "<non-stringable value>";
    }
  }
  qjs_free_value(ctxPtr, val);
});

statusEl.textContent = "Waiting for QuickJS wasm (see README for build)";

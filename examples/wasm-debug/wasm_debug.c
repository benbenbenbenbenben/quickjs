#include <string.h>

/* Glue code for using QuickJS debugger handler from a WebAssembly build
 * (Node or browser) via Emscripten.
 *
 * This file is only an example; you still need to compile the main
 * QuickJS sources (quickjs.c, etc.) with emcc.
 */

#include <emscripten/emscripten.h>

#include "quickjs.h"

/* JS hooks implemented in the host environment.
 *
 * In Node or the browser you can set:
 *   Module.onQuickJSDebugBreakAsync = async msg => { ... };
 *   Module.onQuickJSDebugBreak = msg => { ... };
 *   Module.onQuickJSError = msg => { ... };
 * and this glue will call them for debugger breaks and uncaught errors.
 *
 * The debugger break path is async-aware via Emscripten Asyncify so that
 * the QuickJS VM can pause at a `debugger;` and resume later.
 */
EM_ASYNC_JS(int, js_debugger_break_async, (JSRuntime *rt, const char *info), {
  const msg = UTF8ToString(info);
  let result = { action: "step" };
  if (Module.onQuickJSDebugBreakAsync) {
    const r = await Module.onQuickJSDebugBreakAsync(msg);
    if (r && typeof r.action === "string") {
      result = r;
    }
  } else if (Module.onQuickJSDebugBreak) {
    await Module.onQuickJSDebugBreak(msg);
  } else {
    console.log("[quickjs-debugger]", msg);
  }
  if (result && result.action === "continue") {
    return 1;
  }
  return 0;
});

EM_JS(void, js_error_report, (const char *info), {
  const msg = UTF8ToString(info);
  if (Module.onQuickJSError) {
    Module.onQuickJSError(msg);
  } else {
    console.error("[quickjs-error]", msg);
  }
});

/* Logging hook used by a basic console.log implementation inside QuickJS. */
EM_JS(void, js_console_log, (const char *info), {
  const msg = UTF8ToString(info);
  if (Module.onQuickJSLog) {
    Module.onQuickJSLog(msg);
  } else if (Module.onQuickJSError) {
    Module.onQuickJSError(msg);
  } else {
    console.log("[quickjs-log]", msg);
  }
});

static JSRuntime *wasm_debug_rt;

/* Minimal helpers exported for the JS host.
 *
 * These wrap inline APIs like JS_IsException / JS_ToCString so that
 * they exist as concrete C functions Emscripten can export.
 */
EMSCRIPTEN_KEEPALIVE
int qjs_is_exception(JSValue v)
{
    return JS_IsException(v);
}

EMSCRIPTEN_KEEPALIVE
const char *qjs_to_cstring(JSContext *ctx, JSValueConst v)
{
    return JS_ToCString(ctx, v);
}

EMSCRIPTEN_KEEPALIVE
void qjs_free_cstring(JSContext *ctx, const char *ptr)
{
    JS_FreeCString(ctx, ptr);
}

EMSCRIPTEN_KEEPALIVE
void qjs_free_value(JSContext *ctx, JSValue v)
{
    JS_FreeValue(ctx, v);
}

/* Dump the current exception as a printable string and call js_error_report().
 *
 * This is a lightweight replacement for js_std_dump_error() suitable
 * for wasm builds that don't link quickjs-libc.c.
 */
EMSCRIPTEN_KEEPALIVE
void qjs_dump_exception(JSContext *ctx)
{
    JSValue exception_val;
    const char *msg;

    if (!JS_HasException(ctx))
        return;

    exception_val = JS_GetException(ctx);
    msg = JS_ToCString(ctx, exception_val);
    if (msg) {
        js_error_report(msg);
        JS_FreeCString(ctx, msg);
    }
    JS_FreeValue(ctx, exception_val);
}

/* Simple debugger handler for wasm builds.
 *
 * It is invoked whenever a `debugger;` statement executes. It captures
 * Error().stack in the current context and forwards the whole stack
 * string to the JS host via js_debugger_break().
 */
static int wasm_debugger_handler(JSContext *ctx, void *opaque)
{
    const char *src = "new Error().stack";
    JSValue val;
    const char *stack;

    (void)opaque;

    val = JS_Eval(ctx, src, strlen(src), "<debugger>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(val)) {
        /* Ignore errors in the debugger hook itself. */
        JS_FreeValue(ctx, val);
        return 0; /* continue execution even if the hook failed */
    }

    stack = JS_ToCString(ctx, val);
    if (stack) {
        int action = js_debugger_break_async(wasm_debug_rt, stack);
        JS_FreeCString(ctx, stack);
        if (action == 1 && wasm_debug_rt) {
            /* "Continue": disable further debugger breaks for this runtime. */
            JS_SetDebuggerHandler(wasm_debug_rt, NULL, NULL);
        }
    }
    JS_FreeValue(ctx, val);

    /* 0 = continue execution, non-zero would abort */
    return 0;
}
 
/* Example API: call this once after creating the runtime.
 *
 * From JS you typically call this through ccall/cwrap or embind,
 * passing the pointer/handle to the JSRuntime you created.
 *
 * Note: this function must be exported from the wasm module.
 */
EMSCRIPTEN_KEEPALIVE
void qjs_install_debugger_handler(JSRuntime *rt)
{
    wasm_debug_rt = rt;
    JS_SetDebuggerHandler(rt, wasm_debugger_handler, NULL);
}


/* Minimal console.log implementation for wasm builds.
 *
 * It creates a global `console.log` function inside the given context
 * that forwards its stringified arguments to the host via
 * js_console_log().
 */
static JSValue qjs_console_log_fn(JSContext *ctx, JSValueConst this_val,
                                  int argc, JSValueConst *argv)
{
    char buf[1024];
    size_t pos = 0;
    int i;

    (void)this_val;

    buf[0] = '\0';
    for (i = 0; i < argc; i++) {
        const char *part = JS_ToCString(ctx, argv[i]);
        size_t len;
        if (!part)
            continue;
        if (i != 0 && pos < sizeof(buf) - 2) {
            buf[pos++] = ' ';
        }
        len = strlen(part);
        if (len > sizeof(buf) - 1 - pos)
            len = sizeof(buf) - 1 - pos;
        memcpy(buf + pos, part, len);
        pos += len;
        buf[pos] = '\0';
        JS_FreeCString(ctx, part);
        if (pos >= sizeof(buf) - 1)
            break;
    }

    js_console_log(buf);
    return JS_UNDEFINED;
}

EMSCRIPTEN_KEEPALIVE
void qjs_install_console(JSContext *ctx)
{
    JSValue global_obj, console_obj;

    global_obj = JS_GetGlobalObject(ctx);
    console_obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, console_obj, "log",
                      JS_NewCFunction(ctx, qjs_console_log_fn, "log", 1));
    JS_SetPropertyStr(ctx, global_obj, "console", console_obj);
    JS_FreeValue(ctx, global_obj);
}

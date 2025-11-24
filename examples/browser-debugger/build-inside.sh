#!/usr/bin/env bash
set -euo pipefail

# This script is intended to run *inside* a container image that
# has Emscripten (emcc), Node.js and npm available. It builds the
# QuickJS WebAssembly module with debugger support and then builds
# the browser-debugger example.

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="examples/browser-debugger"

cd "$REPO_ROOT"

mkdir -p "$APP_DIR/public"

emcc \
  -DCONFIG_VERSION=\"dev\" \
  -I. \
  quickjs.c cutils.c libunicode.c libregexp.c dtoa.c \
  examples/wasm-debug/wasm_debug.c \
  -s ENVIRONMENT=web \
  -s MODULARIZE=1 -s EXPORT_NAME=QuickJSModule \
  -s EXPORTED_FUNCTIONS='["_JS_NewRuntime","_JS_NewContext","_JS_Eval","_qjs_install_debugger_handler","_qjs_install_console","_qjs_is_exception","_qjs_to_cstring","_qjs_free_cstring","_qjs_free_value","_qjs_dump_exception"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString"]' \
  -o "$APP_DIR/public/quickjs-browser.js"


cd "$APP_DIR"
 
npm install
NODE_OPTIONS="--require ./node-crypto-webcrypto-polyfill.cjs" npm run build


# Multi-stage image that builds QuickJS (wasm) with debugger support
# and the browser-debugger example, then serves the result via nginx.

FROM emscripten/emsdk:3.1.56 AS build

WORKDIR /src

# Copy the whole QuickJS repo into the build image
COPY . .

# Build the wasm module and the browser example
RUN bash examples/browser-debugger/build-inside.sh

# Runtime image: just a static web server
FROM nginx:alpine

# Copy built assets from the build stage
COPY --from=build /src/examples/browser-debugger/dist/ /usr/share/nginx/html/

EXPOSE 80

# nginx base image already has the correct CMD

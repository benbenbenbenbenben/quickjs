import {defineConfig} from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    exclude: ["tests-e2e/**", "node_modules/**"],
  },
});

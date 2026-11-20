import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    // Node >= 25 ships an experimental Web Storage global. Without --localstorage-file it is
    // an inert getter that shadows jsdom's localStorage in the jsdom environment, so turn it
    // off in the test workers (a no-op for Node 22, which also accepts the flag).
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
      threads: { execArgv: ["--no-experimental-webstorage"] },
    },
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
  },
});

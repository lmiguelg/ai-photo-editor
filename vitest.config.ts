import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" path so tests can import modules that use it.
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

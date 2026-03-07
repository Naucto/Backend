import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "swagger.json",
  output: {
    path: "generated_client",
    postProcess: ["prettier"],
  },
  plugins: [
    {
      name: "@hey-api/client-axios",
      // Bundle the client runtime inside generated_client so the frontend
      // can drop it in as-is without an extra npm dependency.
      bundle: true,
    },
    {
      name: "@hey-api/sdk",
      operations: { nesting: "operationId" },
    },
    {
      name: "@hey-api/typescript",
      // Emit runtime enum objects (e.g. ProjectResponseDtoStatus.COMPLETED)
      // alongside the union types, giving callers a type-safe constant to
      // reference instead of raw string literals.
      enums: "javascript",
    },
  ],
});

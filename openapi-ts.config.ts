import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "swagger.json",
  output: {
    path: "client/src",
    postProcess: ["prettier"],
  },
  plugins: [
    {
      name: "@hey-api/client-fetch",
      // Bundle the client runtime inside the package so consumers don't need
      // an extra npm dependency.
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

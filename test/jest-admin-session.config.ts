import { pathsToModuleNameMapper } from "ts-jest";
import { readConfigFile, sys } from "typescript";
import type { Config } from "jest";

const { config } = readConfigFile("./tsconfig.json", sys.readFile);
export default {
  rootDir: "..",
  testMatch: ["<rootDir>/test/admin-session.e2e-spec.ts"],
  testEnvironment: "node",
  transform: { "^.+\\.[tj]s$": ["ts-jest", { useESM: true }] },
  transformIgnorePatterns: ["/node_modules/(?!(jose|jwks-rsa|uuid)/)"],
  moduleNameMapper: pathsToModuleNameMapper(config.compilerOptions.paths, { prefix: "<rootDir>/src/" }),
  testTimeout: 30000
} satisfies Config;

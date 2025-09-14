import { pathsToModuleNameMapper } from "ts-jest";
import { readConfigFile, sys } from "typescript";
import type { Config } from "jest";

const configFile = readConfigFile("./tsconfig.json", sys.readFile);
const compilerOptions = configFile.config.compilerOptions;

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  rootDir: "./src",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths || {}, {
    prefix: "<rootDir>/",
  }),
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  collectCoverage: true,
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  coveragePathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/../jest.setup.ts"],
  verbose: false, // true for more information
};

export default config;

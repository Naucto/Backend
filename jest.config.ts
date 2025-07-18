import { pathsToModuleNameMapper } from "ts-jest";
import { readConfigFile, sys } from "typescript";

const configFile = readConfigFile("./tsconfig.json", sys.readFile);
const compilerOptions = configFile.config.compilerOptions;

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./src",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.spec\\.ts$",
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths || {}, {
    prefix: "<rootDir>/",
  }),
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverage: true,
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  coveragePathIgnorePatterns: ["/node_modules/"],
  verbose: true
};

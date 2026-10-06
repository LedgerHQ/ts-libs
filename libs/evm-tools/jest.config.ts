export default {
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } } },
    ],
  },
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest-env-setup.js"],
  testRegex: ".(test|spec).[jt]sx?$",
  modulePathIgnorePatterns: ["__tests__/fixtures"],
  coveragePathIgnorePatterns: ["src/__tests__"],
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};

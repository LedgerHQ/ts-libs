export default {
  transform: {
    "^.+\\.(ts|tsx|js)$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } } },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?@noble)"],
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

export default {
  transform: {
    "^.+\\.(ts|tsx|js)$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } } },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?(@noble|@bitcoinerlab))"],
  testEnvironment: "node",
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};

export default {
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } } },
    ],
  },
  testEnvironment: "node",
  testPathIgnorePatterns: ["lib/", "lib-es/"],
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};

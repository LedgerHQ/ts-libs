export default {
  transform: {
    "^.+\\.(ts|tsx)$": ["@swc/jest", { jsc: { parser: { syntax: "typescript" } } }],
  },
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/src/setup.ts"],
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};

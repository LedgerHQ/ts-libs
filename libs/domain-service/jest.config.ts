const transform = {
  "^.+\\.(t|j)sx?$": [
    "@swc/jest",
    { jsc: { target: "es2022", parser: { syntax: "typescript", tsx: true } } },
  ],
};

export default {
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  coveragePathIgnorePatterns: ["src/__tests__"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
  projects: [
    {
      transform,
      testEnvironment: "node",
      testRegex: ".(test|spec).[jt]s$",
    },
    {
      transform,
      displayName: "dom",
      testEnvironment: "jsdom",
      testRegex: ".react.(test|spec).tsx$",
    },
  ],
};

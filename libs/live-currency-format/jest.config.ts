const project = {
  transform: {
    "^.+\\.(ts|tsx)$": ["@swc/jest", { jsc: { parser: { syntax: "typescript" } } }],
  },
  testEnvironment: "node",
};

export default {
  projects: [
    { ...project, displayName: "bignumber.js@11" },
    {
      ...project,
      displayName: "bignumber.js@9",
      moduleNameMapper: { "^bignumber\\.js$": "bignumber.js-v9" },
    },
  ],
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};

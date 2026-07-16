export default {
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript" } },
      },
    ],
  },
  testEnvironment: "node",
};

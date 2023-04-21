// see https://github.com/microsoft/vscode-test/issues/37#issuecomment-700167820
const path = require("path");
const rootDir = __dirname

module.exports = {
	// rootDir,
	// moduleFileExtensions: ["js"],
  // testMatch: ["**/*.test.js"],
  // testEnvironment: path.resolve(rootDir, "test/vscode-environment.js"),
  verbose: true,
  // moduleNameMapper: {
  //   vscode: path.resolve(rootDir, "test", "vscode.js"), // Maps to the testEnvironment specified above
  // },
};

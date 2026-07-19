/* Jest setup: stub native modules that source files import at module scope.
 * Pure-logic suites don't touch these, but importing a module that reaches
 * for a native dependency (e.g. AsyncStorage) pulls in the native stack (jest
 * resolves `.native`), so the dependency must be mocked or the import throws. */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

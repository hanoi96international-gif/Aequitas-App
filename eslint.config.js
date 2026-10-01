// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // Tests: jest.mock() muss vor dem Laden des Moduls stehen, und
  // jest.isolateModules() verlangt require() -- nur so bekommt jeder Fall
  // einen frischen Modulzustand. config.test.ts liest process.env bewusst
  // dynamisch (prueft jede Variable aus einer Liste).
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
      'expo/no-dynamic-env-var': 'off',
    },
  },
]);

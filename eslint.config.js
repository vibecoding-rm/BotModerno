import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off', // Allow console for Workers
      'prefer-const': 'error',
      'no-var': 'error',
    },
    ignores: [
      'node_modules/',
      'dist/',
      'functions/',
      'web/',
      'web-panel/',
    ],
  },
];
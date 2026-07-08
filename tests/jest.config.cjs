/* jest.config.cjs — ESM nativo: correr con node --experimental-vm-modules (ver script "test") */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: {},
  collectCoverageFrom: ['<rootDir>/src/**/*.js'],
};

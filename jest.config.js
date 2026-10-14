const transformPackages = [
  '(?:jest-)?react-native',
  '@react-native(?:-community)?',
  '@react-navigation',
  '@testing-library/react-native',
  'test-renderer',
];

/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // pnpm-aware: real paths look like
  // node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/file.js — the allowlist
  // must apply to the segment AFTER the last node_modules, not the .pnpm one.
  transformIgnorePatterns: [
    `node_modules/(?:\\.pnpm/[^/]+/)?node_modules/(?!${transformPackages.join('|')})`,
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/lib/'],
  testPathIgnorePatterns: ['/node_modules/', '/lib/', '/example/'],
  fakeTimers: {
    enableGlobally: false,
  },
};

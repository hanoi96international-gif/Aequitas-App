const expo = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  // @noble/post-quantum (lib/pq.ts) und seine @noble-Abhaengigkeiten sind
  // reine ES-Module: Jest muss sie wie die Expo-Pakete uebersetzen.
  transformIgnorePatterns: [
    expo.transformIgnorePatterns[0].replace('(?!(.pnpm|', '(?!(.pnpm|@noble|'),
    ...expo.transformIgnorePatterns.slice(1),
  ],
};

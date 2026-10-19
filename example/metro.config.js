// Metro config for the linked library. `react-native-smooth-task` resolves
// to ../src via the package's `react-native` field (TS source — no build
// step needed), so Metro must watch the repo root.
//
// ../src files import react / react-native / @react-navigation/* — a normal
// hierarchical lookup would find the REPO's devDependency copies first and
// create duplicate singletons. resolveRequest pins exactly those modules to
// THIS app's copies; everything else falls through to the default resolver
// (Expo's own, which transitive deps like expo-modules-core rely on).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const appModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];

// The library is consumed from source — map its public entry points onto
// ../src files directly (mirrors the package's `react-native` field).
const LIB_ENTRIES = {
  'react-native-smooth-task': 'src/index.ts',
  'react-native-smooth-task/stack': 'src/stack.ts',
  'react-native-smooth-task/native-stack': 'src/native-stack.ts',
};

const SINGLETON_PREFIXES = ['react/', 'react-native/', '@react-navigation/'];
const SINGLETONS = new Set(['react', 'react-native']);

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const libEntry = LIB_ENTRIES[moduleName];
  if (libEntry) {
    return { type: 'sourceFile', filePath: path.resolve(workspaceRoot, libEntry) };
  }
  const isSingleton =
    SINGLETONS.has(moduleName) ||
    SINGLETON_PREFIXES.some((p) => moduleName.startsWith(p));
  if (isSingleton) {
    try {
      const filePath = require.resolve(moduleName, { paths: [appModules] });
      return { type: 'sourceFile', filePath };
    } catch {
      // fall through to the default resolver
    }
  }
  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

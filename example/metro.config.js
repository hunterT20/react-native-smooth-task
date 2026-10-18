// Metro config for the linked library. `react-native-smooth-task` resolves to
// ../src via the package's `react-native` field (TS source — no build step
// needed), so Metro must watch the repo root. disableHierarchicalLookup +
// nodeModulesPaths forces react / react-native / @react-navigation/* to
// resolve ONLY from this app's node_modules — otherwise ../src files would
// pick up the repo's devDependency copies and create duplicate singletons.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

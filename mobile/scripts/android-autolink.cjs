const { dirname, join } = require('node:path');
const mobile = dirname(__dirname);
const android = join(mobile, 'android');
const name = 'react-native-safe-area-context';
const root = dirname(require.resolve(`${name}/package.json`));
const sourceDir = join(root, 'android');
const dependency = require(join(root, 'react-native.config.js')).dependency.platforms.android;
const packageName = 'org.levelmaxing.app';

process.stdout.write(JSON.stringify({
  reactNativeVersion: require('react-native/package.json').version,
  project: { android: { sourceDir: android, appName: 'app', packageName, applicationId: packageName, mainActivity: '.MainActivity' } },
  dependencies: { [name]: { name, root, platforms: { android: {
    ...dependency,
    sourceDir,
    buildTypes: [],
    packageImportPath: 'import com.th3rdwave.safeareacontext.SafeAreaContextPackage;',
    packageInstance: 'new SafeAreaContextPackage()',
    cmakeListsPath: join(sourceDir, dependency.cmakeListsPath).replaceAll('\\', '/'),
  } } } },
}));

const { dirname, join } = require('node:path');
const { parseArgs } = require('node:util');
const metro = require('metro');

const root = dirname(__dirname);
const plugin = require(require.resolve('@react-native/community-cli-plugin', {
  paths: [dirname(require.resolve('react-native/package.json'))],
}));

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    'entry-file': { type: 'string', default: 'index.js' },
    platform: { type: 'string', default: 'android' },
    dev: { type: 'string', default: 'false' },
    minify: { type: 'string' },
    'bundle-output': { type: 'string' },
    'assets-dest': { type: 'string' },
    'sourcemap-output': { type: 'string' },
    'unstable-transform-profile': { type: 'string' },
    'max-workers': { type: 'string', default: '2' },
    port: { type: 'string', default: '8081' },
    'reset-cache': { type: 'boolean' },
    verbose: { type: 'boolean' },
  } });
  const config = await metro.loadConfig({ cwd: root, config: join(root, 'metro.config.cjs'),
    resetCache: values['reset-cache'] ?? true, maxWorkers: Number(values['max-workers']) });
  if (command === 'start') {
    const port = Number(values.port);
    await metro.runServer({ ...config, server: { ...config.server, port } }, {
      host: '127.0.0.1',
      unstable_extraMiddleware: [(request, response, next) => {
        if (request.url !== '/status') { next(); return; }
        response.setHeader('Content-Type', 'text/plain');
        response.end('packager-status:running');
      }],
    });
    console.log(`Metro is listening on http://127.0.0.1:${port}`);
    return;
  }
  if (command !== 'bundle' || !values['bundle-output']) throw new Error('Use start or bundle with --bundle-output.');
  await plugin.unstable_buildBundleWithConfig({
    entryFile: values['entry-file'], platform: values.platform, dev: values.dev === 'true',
    minify: values.minify === undefined ? undefined : values.minify === 'true',
    bundleOutput: values['bundle-output'], assetsDest: values['assets-dest'],
    sourcemapOutput: values['sourcemap-output'], unstableTransformProfile: values['unstable-transform-profile'],
  }, config);
}

main().catch(error => { console.error(error); process.exitCode = 1; });

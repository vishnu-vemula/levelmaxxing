const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseEnv } = require('node:util');

const publicKeys = new Set(['API_URL', 'ENABLE_LOCAL_AUTH', 'FIREBASE_API_KEY',
  'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'SUPABASE_PUBLISHABLE_KEY'].map(key => `APP_PUBLIC_${key}`));

module.exports = function configure(api) {
  api.cache(false);
  const envFile = join(__dirname, '.env.local');
  const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [function publicEnvironment({ types }) {
      return { visitor: { MemberExpression(path) {
        const node = path.node;
        if (node.computed || !types.isIdentifier(node.property) || !publicKeys.has(node.property.name)) return;
        if (!types.isMemberExpression(node.object) || node.object.computed ||
          !types.isIdentifier(node.object.object, { name: 'process' }) ||
          !types.isIdentifier(node.object.property, { name: 'env' })) return;
        const key = node.property.name;
        const previousKey = key.replace(/^APP_PUBLIC_/, 'EXPO_PUBLIC_');
        const value = process.env[key] ?? env[key] ?? process.env[previousKey] ?? env[previousKey];
        path.replaceWith(value === undefined ? types.unaryExpression('void', types.numericLiteral(0)) : types.stringLiteral(value));
      } } };
    }],
  };
};

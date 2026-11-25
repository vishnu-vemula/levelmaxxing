import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', '.expo', '.build', 'DerivedData']);
const sourceFile = /\.[cm]?[jt]sx?$/;
const violations = [];
let imports = 0;
const locate = (filename) => relative(root, filename).split(sep);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) return walk(path);
    return entry.isFile() && sourceFile.test(entry.name) ? [path] : [];
  });
}

const topLevelApps = new Set(['backend', 'mobile']);

function workspaceUnit(location) {
  if (location[0] === 'backend' && location[1] === 'admin') return { kind: 'app', name: 'admin', length: 2 };
  if (topLevelApps.has(location[0])) return { kind: 'app', name: location[0], length: 1 };
  if (location[0] === 'packages') return { kind: 'package', name: location[1], length: 2 };
}

function featureOf(location) {
  const i = location.indexOf('features', workspaceUnit(location)?.length ?? 0);
  return i < 0 ? undefined : { name: location[i + 1], path: location.slice(i + 2) };
}

function importedPath(filename, target) {
  if (target.startsWith('.')) return resolve(dirname(filename), target);
  const local = /^@levelmaxing\/(.+)/.exec(target);
  if (!local) return null;
  const [name, ...subpath] = local[1].split('/');
  if (name === 'api') return resolve(root, 'backend', ...subpath);
  if (name === 'mobile') return resolve(root, 'mobile', ...subpath);
  if (name === 'admin') return resolve(root, 'backend', 'admin', ...subpath);
  if (name === 'contracts' || name === 'design-tokens') return resolve(root, 'packages', name, ...subpath);
  return null;
}

function validate(filename, target, position, source) {
  imports++;
  const imported = importedPath(filename, target);
  if (!imported) return;
  const from = locate(filename);
  const to = locate(imported);
  const fromUnit = workspaceUnit(from);
  const toUnit = workspaceUnit(to);
  const sameWorkspacePackage = fromUnit?.kind === toUnit?.kind && fromUnit?.name === toUnit?.name;
  const edgeEntry = from[0] === 'backend' && from[1] === 'supabase';
  const platformModule = fromUnit?.kind === 'app' &&
    (fromUnit.name === 'backend' || fromUnit.name === 'mobile') &&
    from[fromUnit.length] === 'src' && from[fromUnit.length + 1] === 'platform';
  const feature = featureOf(from);
  const otherFeature = featureOf(to);
  const privateFeature = otherFeature?.path.length && !/^index\.[cm]?[jt]sx?$/.test(otherFeature.path.join('/'));
  let violation;
  if (to[0] === '..') violation = 'source import leaves this workspace';
  else if (fromUnit?.kind === 'package' && toUnit?.kind === 'app') violation = 'a shared package depends on an app';
  else if (fromUnit?.kind === 'app' && toUnit?.kind === 'app' && !sameWorkspacePackage) violation = 'apps must communicate through contracts';
  else if (sameWorkspacePackage && platformModule && otherFeature) violation = 'generic platform code cannot depend on feature modules';
  else if (sameWorkspacePackage && feature && otherFeature && feature.name !== otherFeature.name && privateFeature) violation = 'use the other feature’s public entrypoint';
  else if (toUnit?.kind === 'package' && to.length > toUnit.length && !sameWorkspacePackage) violation = 'use the other package’s published name';
  else if (edgeEntry && to[0] === 'backend' && to[1] !== 'supabase' && to.slice(1).join('/') !== 'src/cloud.ts') violation = 'edge deployment must enter through the cloud composition root';
  if (violation) {
    const { line } = source.getLineAndCharacterOfPosition(position);
    violations.push(from.join('/') + ':' + (line + 1) + ' · ' + target + ' · ' + violation);
  }
}

for (const dir of ['backend', 'mobile', 'packages']) {
  for (const filename of walk(resolve(root, dir))) {
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const target = node.moduleSpecifier;
        if (target && ts.isStringLiteralLike(target)) validate(filename, target.text, target.getStart(source), source);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [target] = node.arguments;
        if (target && ts.isStringLiteralLike(target)) validate(filename, target.text, target.getStart(source), source);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Dependency boundaries passed (' + imports + ' import/export references).');
}

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => name.endsWith('.test.ts'))
  .map(name => `.test-build/tests/${name.replace(/\.ts$/, '.js')}`);
if (!tests.length) throw new Error('No regression tests found');
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);

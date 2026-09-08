import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
if (existsSync('.env')) loadEnvFile('.env');
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('A command is required.');
const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error('Could not start command.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

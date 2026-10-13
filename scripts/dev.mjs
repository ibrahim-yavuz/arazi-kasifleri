// Starts the room server (port 8787) and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['vite-node', 'server/index.ts'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());

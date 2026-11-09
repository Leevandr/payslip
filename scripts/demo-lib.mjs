// Shared helpers for the demo scripts: run the real CLI, print what a human would type, check the exit code.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'bin', 'payslip-proof.js');
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
export const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
export const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

export function heading(text) {
  console.log(`\n${bold(`== ${text}`)}`);
}

export function say(text) {
  console.log(dim(text));
}

export async function cli(args, { expect = 0, show = true, display } = {}) {
  const shown = display ?? args.join(' ');
  if (show) console.log(`\n$ payslip-proof ${shown}`);
  const { code, out } = await new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1' } });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('close', (c) => resolve({ code: c, out: buf }));
  });
  if (show) process.stdout.write(out);
  if (code !== expect) {
    console.error(`\nDEMO FAILED: expected exit code ${expect} from "payslip-proof ${shown}" but got ${code}`);
    if (!show) console.error(out);
    process.exit(1);
  }
  if (show && expect !== 0) console.log(dim(`(exit code ${code}, as expected)`));
  return out;
}

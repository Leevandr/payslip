import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = paint('32;1');
export const red = paint('31;1');
export const dim = paint('2');
export const bold = paint('1');
export const yellow = paint('33');

export class UsageError extends Error {}
/** The contract (or chain) said no. Exit code 3. */
export class ChainRefused extends Error {}

export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${file} is not valid JSON`);
  }
}

export async function writeJson(file, value, { secret = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2)
    // keep one Merkle step per line so payslips stay readable
    .replace(/\{\s+"side": "(left|right)",\s+"hash": "([0-9a-f]{64})"\s+\}/g, '{ "side": "$1", "hash": "$2" }');
  await writeFile(file, `${text}\n`, { mode: secret ? 0o600 : 0o644 });
}

export function printChecks(checks) {
  for (const c of checks) console.log(`  ${c.ok ? green('ok  ') : red('FAIL')} ${c.text}`);
}

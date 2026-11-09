#!/usr/bin/env node
import { main } from '../src/cli/main.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // 70 = internal error, kept apart from 1 (verification failed) so a crash can never pass for a failed check
  console.error(`internal error: ${e?.stack ?? e}`);
  process.exitCode = 70;
}

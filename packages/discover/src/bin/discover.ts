#!/usr/bin/env tsx
/**
 * discover CLI entry point: thin process adapter over runCli.
 *
 * @summary discover CLI entry point.
 * @module
 */

import { runCli } from '../cli.js';

process.exitCode = runCli(
  process.argv.slice(2),
  (line) => {
    process.stdout.write(`${line}\n`);
  },
  (line) => {
    process.stderr.write(`${line}\n`);
  }
);

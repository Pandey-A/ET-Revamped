#!/usr/bin/env node
/**
 * Next.js standalone output does not include public/ or .next/static/.
 * Copy them so `node .next/standalone/server.js` can serve CSS and assets.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next', 'standalone');
const staticDir = join(root, '.next', 'static');
const publicDir = join(root, 'public');

if (!existsSync(join(standalone, 'server.js'))) {
  console.error('Missing .next/standalone/server.js — run `next build` first.');
  process.exit(1);
}
if (!existsSync(staticDir)) {
  console.error('Missing .next/static — run `next build` first.');
  process.exit(1);
}

const standalonePublic = join(standalone, 'public');
const standaloneStatic = join(standalone, '.next', 'static');

rmSync(standalonePublic, { recursive: true, force: true });
rmSync(standaloneStatic, { recursive: true, force: true });

cpSync(publicDir, standalonePublic, { recursive: true });
mkdirSync(join(standalone, '.next'), { recursive: true });
cpSync(staticDir, standaloneStatic, { recursive: true });

console.log('Synced public/ and .next/static/ into .next/standalone/');

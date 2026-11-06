// Copies the Vite build (../dist) into ./public with the response headers.
import { cp, copyFile, rm } from 'node:fs/promises';
const out = new URL('./public/', import.meta.url);
await rm(out, { recursive: true, force: true });
await cp(new URL('../dist/', import.meta.url), out, { recursive: true });
await copyFile(new URL('./_headers', import.meta.url), new URL('_headers', out));

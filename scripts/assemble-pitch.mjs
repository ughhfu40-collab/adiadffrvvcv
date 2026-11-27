import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../docs/pitch/final/', import.meta.url);
const { parts, sha256 } = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
const video = Buffer.concat(await Promise.all(
  parts.map((name) => readFile(new URL(name, source))),
));

if (createHash('sha256').update(video).digest('hex') !== sha256) {
  throw new Error('The assembled pitch video does not match its SHA-256 checksum.');
}

await writeFile(new URL('../dist/pitch-final.mp4', import.meta.url), video);

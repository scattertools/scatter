import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseSize,
  formatSize,
  loadConfig,
  saveConfig,
  type Config,
} from '../src/config.ts';

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scatter-config-'));
}

// --- parseSize ---

test('parseSize handles bare numbers as bytes', () => {
  assert.equal(parseSize('0'), 0);
  assert.equal(parseSize('1024'), 1024);
});

test('parseSize handles all unit suffixes (long + short forms)', () => {
  assert.equal(parseSize('512B'), 512);
  assert.equal(parseSize('1K'), 1024);
  assert.equal(parseSize('1KB'), 1024);
  assert.equal(parseSize('100MB'), 100 * 1024 ** 2);
  assert.equal(parseSize('2M'), 2 * 1024 ** 2);
  assert.equal(parseSize('50GB'), 50 * 1024 ** 3);
  assert.equal(parseSize('1G'), 1024 ** 3);
  assert.equal(parseSize('3TB'), 3 * 1024 ** 4);
  assert.equal(parseSize('1T'), 1024 ** 4);
});

test('parseSize is case-insensitive and tolerates whitespace', () => {
  assert.equal(parseSize('  10gb  '), 10 * 1024 ** 3);
  assert.equal(parseSize('10 GB'), 10 * 1024 ** 3);
  assert.equal(parseSize('512kb'), 512 * 1024);
});

test('parseSize accepts decimals and floors the result', () => {
  assert.equal(parseSize('1.5KB'), Math.floor(1.5 * 1024));
  assert.equal(parseSize('2.5MB'), Math.floor(2.5 * 1024 ** 2));
  // 0.0009 KB = 0.9216 bytes -> floors to 0.
  assert.equal(parseSize('0.0009KB'), 0);
});

test('parseSize throws on malformed input', () => {
  assert.throws(() => parseSize(''), /Invalid size/);
  assert.throws(() => parseSize('abc'), /Invalid size/);
  assert.throws(() => parseSize('10PB'), /Invalid size/); // unsupported unit
  assert.throws(() => parseSize('GB'), /Invalid size/); // no number
  assert.throws(() => parseSize('1.2.3MB'), /Invalid size/);
});

// --- formatSize ---

test('formatSize picks the right unit and precision', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1023), '1023 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1024 ** 2), '1.0 MB');
  assert.equal(formatSize(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatSize(1024 ** 3), '1.00 GB');
  assert.equal(formatSize(10 * 1024 ** 3), '10.00 GB');
  assert.equal(formatSize(1024 ** 4), '1.00 TB');
  assert.equal(formatSize(2.5 * 1024 ** 4), '2.50 TB');
});

test('formatSize boundary just under 1KB stays in bytes', () => {
  assert.equal(formatSize(1023), '1023 B');
  assert.equal(formatSize(1024 ** 2 - 1), `${((1024 ** 2 - 1) / 1024).toFixed(1)} KB`);
});

// --- loadConfig / saveConfig ---

test('loadConfig returns defaults when no config file exists', async () => {
  const dataDir = await makeRoot();
  try {
    const cfg = loadConfig({ dataDir });
    assert.equal(cfg.nodeId, null);
    assert.equal(cfg.coordinator, 'http://localhost:4000');
    assert.equal(cfg.capacityBytes, 10 * 1024 ** 3);
    assert.equal(cfg.port, 7878);
    assert.equal(cfg.dataDir, dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('loadConfig applies overrides over defaults', async () => {
  const dataDir = await makeRoot();
  try {
    const cfg = loadConfig({
      dataDir,
      coordinator: 'https://coord.example.com',
      capacityBytes: 42,
      port: 9999,
    });
    assert.equal(cfg.coordinator, 'https://coord.example.com');
    assert.equal(cfg.capacityBytes, 42);
    assert.equal(cfg.port, 9999);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('saveConfig then loadConfig round-trips persisted values', async () => {
  const dataDir = await makeRoot();
  try {
    const original: Config = {
      nodeId: 'node-xyz',
      coordinator: 'https://my-coord.test',
      capacityBytes: 123_456_789,
      dataDir,
      port: 5555,
      sessionToken: 'sess-tok',
      nodeToken: 'node-tok',
    };
    saveConfig(original);

    const reloaded = loadConfig({ dataDir });
    assert.deepEqual(reloaded, original);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('overrides win over values persisted on disk', async () => {
  const dataDir = await makeRoot();
  try {
    saveConfig({
      nodeId: 'persisted',
      coordinator: 'http://localhost:4000',
      capacityBytes: 100,
      dataDir,
      port: 7878,
      sessionToken: null,
      nodeToken: null,
    });
    const cfg = loadConfig({ dataDir, port: 8080, capacityBytes: 200 });
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.capacityBytes, 200);
    // Non-overridden persisted field is retained.
    assert.equal(cfg.nodeId, 'persisted');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('loadConfig ignores a corrupt config.json and falls back to defaults', async () => {
  const dataDir = await makeRoot();
  try {
    await writeFile(join(dataDir, 'config.json'), '{ not valid json ', 'utf8');
    const cfg = loadConfig({ dataDir });
    assert.equal(cfg.coordinator, 'http://localhost:4000');
    assert.equal(cfg.port, 7878);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('loadConfig rejects a structurally invalid persisted config', async () => {
  const dataDir = await makeRoot();
  try {
    // Valid JSON but a bad coordinator URL + out-of-range port -> zod throws.
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({ coordinator: 'not-a-url', port: 70000 }),
      'utf8',
    );
    assert.throws(() => loadConfig({ dataDir }));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('saveConfig writes pretty-printed JSON to dataDir/config.json', async () => {
  const dataDir = await makeRoot();
  try {
    const cfg: Config = {
      nodeId: null,
      coordinator: 'http://localhost:4000',
      capacityBytes: 10 * 1024 ** 3,
      dataDir,
      port: 7878,
      sessionToken: null,
      nodeToken: null,
    };
    saveConfig(cfg);
    const text = await readFile(join(dataDir, 'config.json'), 'utf8');
    assert.deepEqual(JSON.parse(text), cfg);
    assert.match(text, /\n  "/, 'should be 2-space indented');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

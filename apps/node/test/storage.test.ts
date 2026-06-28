import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ShardStorage } from '../src/storage.ts';

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function bytes(n: number, fill = 0): Uint8Array {
  const b = new Uint8Array(n);
  b.fill(fill);
  return b;
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scatter-node-'));
}

test('store then retrieve returns identical bytes; missing returns null', async () => {
  const root = await makeRoot();
  try {
    const s = new ShardStorage(root);
    await s.init();
    const data = bytes(1024, 7);
    await s.store('FILEAAAA', 0, data, sha256Hex(data));

    const got = await s.retrieve('FILEAAAA', 0);
    assert.ok(got);
    assert.deepEqual(got, data);

    const missing = await s.retrieve('FILEAAAA', 99);
    assert.equal(missing, null);
    const missingFile = await s.retrieve('NOPE', 0);
    assert.equal(missingFile, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('store with WRONG expectedHash throws and persists nothing', async () => {
  const root = await makeRoot();
  try {
    const s = new ShardStorage(root);
    await s.init();
    const data = bytes(512, 3);
    await assert.rejects(
      () => s.store('FILEBBBB', 0, data, 'deadbeef'),
      /Shard hash mismatch/,
    );
    // Nothing persisted, counters untouched.
    assert.equal(s.shardCountSync(), 0);
    assert.equal(s.usedBytesSync(), 0);
    assert.equal(await s.retrieve('FILEBBBB', 0), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capacity enforcement: under OK, over throws, usedBytes reflects only stored', async () => {
  const root = await makeRoot();
  try {
    const s = new ShardStorage(root, 1000); // 1000-byte capacity
    await s.init();

    const a = bytes(600, 1);
    await s.store('FILECCCC', 0, a, sha256Hex(a)); // 600 <= 1000 OK
    assert.equal(s.usedBytesSync(), 600);

    const b = bytes(500, 2);
    // 600 + 500 = 1100 > 1000 -> throws.
    await assert.rejects(
      () => s.store('FILECCCC', 1, b, sha256Hex(b)),
      /capacity exceeded/,
    );

    // usedBytes reflects only what was actually stored.
    assert.equal(s.usedBytesSync(), 600);
    assert.equal(s.shardCountSync(), 1);

    // A shard that exactly fits the remaining 400 bytes is accepted.
    const c = bytes(400, 3);
    await s.store('FILECCCC', 2, c, sha256Hex(c));
    assert.equal(s.usedBytesSync(), 1000);
    assert.equal(s.shardCountSync(), 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('usedBytes/shardCount accuracy across store + remove (delete-drift)', async () => {
  const root = await makeRoot();
  try {
    const s = new ShardStorage(root);
    await s.init();

    const d0 = bytes(100, 0);
    const d1 = bytes(200, 1);
    const d2 = bytes(300, 2);
    await s.store('FILEDDDD', 0, d0, sha256Hex(d0));
    await s.store('FILEDDDD', 1, d1, sha256Hex(d1));
    await s.store('FILEDDDD', 2, d2, sha256Hex(d2));
    assert.equal(s.shardCountSync(), 3);
    assert.equal(s.usedBytesSync(), 600);

    // Remove the middle shard; counters track exactly the remaining shards.
    const removed = await s.remove('FILEDDDD', 1);
    assert.equal(removed, true);
    assert.equal(s.shardCountSync(), 2);
    assert.equal(s.usedBytesSync(), 100 + 300);

    // Async accessors agree.
    assert.equal(await s.shardCount(), 2);
    assert.equal(await s.usedBytes(), 400);

    // Removing a non-existent shard returns false and does not drive negative.
    const again = await s.remove('FILEDDDD', 1);
    assert.equal(again, false);
    const neverExisted = await s.remove('FILEDDDD', 42);
    assert.equal(neverExisted, false);
    assert.equal(s.shardCountSync(), 2);
    assert.equal(s.usedBytesSync(), 400);
    assert.ok(s.usedBytesSync() >= 0);
    assert.ok(s.shardCountSync() >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('index PERSISTENCE: a new instance on the same root loads shard-index.json', async () => {
  const root = await makeRoot();
  try {
    const s1 = new ShardStorage(root);
    await s1.init();
    const d0 = bytes(111, 0);
    const d1 = bytes(222, 1);
    await s1.store('FILEEEEE', 0, d0, sha256Hex(d0));
    await s1.store('FILEEEEE', 1, d1, sha256Hex(d1));
    const expectedBytes = s1.usedBytesSync();
    const expectedCount = s1.shardCountSync();
    assert.equal(expectedBytes, 333);
    assert.equal(expectedCount, 2);

    // Fresh instance, same root -> reads shard-index.json.
    const s2 = new ShardStorage(root);
    await s2.init();
    assert.equal(s2.usedBytesSync(), expectedBytes);
    assert.equal(s2.shardCountSync(), expectedCount);
    // And data is still retrievable.
    assert.deepEqual(await s2.retrieve('FILEEEEE', 0), d0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('index REBUILD: corrupt shard-index.json -> rebuilds by walking the dir', async () => {
  const root = await makeRoot();
  try {
    const s1 = new ShardStorage(root);
    await s1.init();
    const d0 = bytes(150, 0);
    const d1 = bytes(250, 1);
    const d2 = bytes(350, 2);
    await s1.store('FILEFFFF', 0, d0, sha256Hex(d0));
    await s1.store('FILEFFFF', 1, d1, sha256Hex(d1));
    await s1.store('FILEFFFF', 2, d2, sha256Hex(d2));
    assert.equal(s1.usedBytesSync(), 750);
    assert.equal(s1.shardCountSync(), 3);

    // Corrupt the persisted index file.
    await writeFile(join(root, 'shard-index.json'), 'not valid json {{{');

    const s2 = new ShardStorage(root);
    await s2.init();
    // Rebuilt counters by walking the shards dir.
    assert.equal(s2.shardCountSync(), 3);
    assert.equal(s2.usedBytesSync(), 750);

    // It also re-persisted a valid index.
    const reloaded = JSON.parse(
      await readFile(join(root, 'shard-index.json'), 'utf8'),
    );
    assert.equal(reloaded.usedBytes, 750);
    assert.equal(reloaded.shardCount, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('index REBUILD: deleted shard-index.json -> rebuilds by walking the dir', async () => {
  const root = await makeRoot();
  try {
    const s1 = new ShardStorage(root);
    await s1.init();
    const d0 = bytes(128, 0);
    await s1.store('FILEGGGG', 0, d0, sha256Hex(d0));

    await rm(join(root, 'shard-index.json'), { force: true });

    const s2 = new ShardStorage(root);
    await s2.init();
    assert.equal(s2.shardCountSync(), 1);
    assert.equal(s2.usedBytesSync(), 128);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

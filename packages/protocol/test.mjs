import { prepareUpload, reassemble } from './src/index.ts';

// Simulate a 1 MB file — fill in chunks because getRandomValues maxes at 64KB
const SIZE = 1_000_000;
const content = new Uint8Array(SIZE);
const CHUNK = 65_536;
for (let i = 0; i < SIZE; i += CHUNK) {
  crypto.getRandomValues(content.subarray(i, Math.min(i + CHUNK, SIZE)));
}

const file = new File([content], 'test.bin', {
  type: 'application/octet-stream',
});

console.log('Original size:', file.size);

const prep = await prepareUpload(file, 'https://scatter.tools');
console.log('File ID:', prep.fileId);
console.log('Shards:', prep.shards.length, 'total');
console.log('Shard size:', prep.shards[0].length, 'bytes each');
console.log('Link:', prep.link);

// Simulate losing 3 shards — RS should still recover
const received = prep.shards.map((s, i) => (i < 3 ? null : s));
console.log('Dropped shards: 0, 1, 2');

const blob = await reassemble(prep.manifest, received, prep.key);
const recovered = new Uint8Array(await blob.arrayBuffer());

const match =
  recovered.length === content.length &&
  recovered.every((b, i) => b === content[i]);

console.log('Recovered bytes match original?', match);

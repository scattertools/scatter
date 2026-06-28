import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLink, parseLink, generateFileId } from '../src/links.ts';
import { generateKey } from '../src/crypto.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

test('buildLink / parseLink round-trip', async () => {
  const key = await generateKey();
  const fileId = generateFileId();
  const link = buildLink('https://scatter.tools', fileId, key);
  assert.equal(link, `https://scatter.tools/f/${fileId}#${key.base64Url}`);

  const parsed = parseLink(link);
  assert.equal(parsed.fileId, fileId);
  assert.deepEqual(parsed.key.raw, key.raw);
  assert.equal(parsed.key.base64Url, key.base64Url);
});

test('buildLink strips a trailing slash from baseUrl', async () => {
  const key = await generateKey();
  const fileId = generateFileId();
  const link = buildLink('https://scatter.tools/', fileId, key);
  assert.equal(link, `https://scatter.tools/f/${fileId}#${key.base64Url}`);
});

test('parseLink rejects a link missing the file ID', () => {
  assert.throws(
    () => parseLink('https://scatter.tools/notafile#abc'),
    /missing file ID/,
  );
});

test('parseLink rejects a link missing the key fragment', () => {
  assert.throws(
    () => parseLink('https://scatter.tools/f/ABCDEF'),
    /missing key in fragment/,
  );
});

test('parseLink rejects malformed (non-URL) input', () => {
  assert.throws(() => parseLink('not a url at all'));
});

test('parseLink rejects a fragment that is not a valid key', () => {
  // Valid file-id path but a too-short key in the fragment.
  assert.throws(
    () => parseLink('https://scatter.tools/f/ABCDEF#AAAA'),
    /Invalid key length/,
  );
});

test('generateFileId returns 26 chars within the alphabet', () => {
  const id = generateFileId();
  assert.equal(id.length, 26);
  for (const ch of id) {
    assert.ok(ALPHABET.includes(ch), `char "${ch}" not in alphabet`);
  }
});

test('generateFileId produces distinct ids', () => {
  const a = generateFileId();
  const b = generateFileId();
  assert.notEqual(a, b);
});

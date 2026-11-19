import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('permit merge preserves the supplied production source byte for byte outside the added block', () => {
  const original = readFileSync('docs/backups/firestore.production-before-permits.rules');
  assert.equal(createHash('sha256').update(original).digest('hex'), '61f0353130be33a5ac8a5665fb89522e8835bdceb19301e2476b841d86e0d622');
  const merged = readFileSync('firestore.rules');
  const start = merged.indexOf(Buffer.from('    // 행위허가:'));
  const end = merged.indexOf(Buffer.from('    // 명시적으로 허용하지 않은 경로는 기본 거부한다.'));
  assert.ok(start > 0 && end > start);
  assert.deepEqual(Buffer.concat([merged.subarray(0, start), merged.subarray(end)]), original);
});

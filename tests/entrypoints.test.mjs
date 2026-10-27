import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

const handlers = readdirSync(new URL('../backend/', import.meta.url)).filter(f => f.endsWith('.js') && !f.startsWith('_'));

test('every backend handler has a matching /api entry point that re-exports it', async () => {
  assert.ok(handlers.length >= 10);
  for (const f of handlers) {
    const entry = (await import(`../api/${f}`)).default;
    const real = (await import(`../backend/${f}`)).default;
    assert.equal(typeof entry, 'function', f);
    assert.equal(entry, real, f);
  }
});

test('/api holds only entry points, so nothing but handlers is exposed as a function', () => {
  const api = readdirSync(new URL('../api/', import.meta.url));
  assert.deepEqual(api.sort(), handlers.sort());
});

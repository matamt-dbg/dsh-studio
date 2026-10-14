import test from 'node:test';
import assert from 'node:assert/strict';
import { studioStorePath } from '../src/host/preset-store.ts';

test('desktop resolves persistence from launcher profile without shell environment', () => {
  assert.equal(studioStorePath({}, { dir: '/desktop/profile' }), '/desktop/profile/studio-data/presets.json');
  assert.equal(studioStorePath({ DSH_PROFILE_DIR: '/stale/shell' }, { dir: '/desktop/profile' }), '/desktop/profile/studio-data/presets.json');
  assert.equal(studioStorePath({ DSH_PROFILE_DIR: '/preview/profile' }), '/preview/profile/studio-data/presets.json');
  assert.throws(() => studioStorePath({}), /profile/);
});

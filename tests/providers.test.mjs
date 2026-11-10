import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import providers from '../electron/providers.js';
const { withColibri, DEFAULT_PROVIDERS, COLIBRI, COLIBRI_REVISION } = providers;

test('fresh installs list Colibri, Ollama and LM Studio', () => {
  assert.deepEqual(withColibri().map(p => p.id), ['ollama', 'lmstudio', 'colibri']);
  assert.equal(COLIBRI.baseUrl, 'http://127.0.0.1:8000/v1');
  assert.match(COLIBRI_REVISION, /^[a-f0-9]{40}$/);
});
test('migration preserves custom providers, paths and labels', () => {
  const old = [{ id: 'lmstudio', label: 'My Gemma', kind: 'openai', baseUrl: 'http://127.0.0.1:5555/v1' }];
  const updated = withColibri(old);
  assert.deepEqual(updated[0], old[0]);
  assert.equal(updated[1].id, 'colibri');
  assert.equal(old.length, 1);
});
test('migration is idempotent and preserves a configured Colibri address', () => {
  const custom = [{ ...COLIBRI, baseUrl: 'http://127.0.0.1:9001/v1' }];
  assert.deepEqual(withColibri(withColibri(custom)), custom);
});
test('provider arrays are independent and cannot mutate defaults', () => {
  const a = withColibri(), b = withColibri();
  a[0].label = 'changed';
  assert.equal(b[0].label, 'Ollama');
  assert.equal(DEFAULT_PROVIDERS[0].label, 'Ollama');
});
test('empty/corrupt provider lists still expose Colibri safely', () => {
  assert.deepEqual(withColibri([]), [{ ...COLIBRI }]);
  assert.equal(withColibri(null).length, 3);
  assert.equal(withColibri([null, 3]).length, 1);
});
function databaseFixture(initial) {
  const saved = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  class Database {
    pragma() {} exec() {} close() {}
    prepare(sql) {
      if (sql.startsWith('SELECT key')) return { all: () => [...saved].map(([key,value]) => ({key,value})) };
      if (sql.startsWith('INSERT INTO settings')) return { run: (key,value) => saved.set(key,value) };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
    transaction(fn) { return fn; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../electron/db.js', import.meta.url), 'utf8'), {
    module, exports: module.exports, Date, JSON,
    require(name) {
      if (name === 'better-sqlite3') return Database;
      if (name === './providers') return providers;
      if (name === 'crypto') return { randomUUID: () => 'fixture-id' };
      throw new Error(name);
    },
  });
  module.exports.init(':memory:');
  return { db: module.exports, saved };
}
test('existing database settings migrate on read without resetting chat/model/secrets', () => {
  const old = { providers: [{ id:'lmstudio', kind:'openai', baseUrl:'http://127.0.0.1:3333' }], activeProvider:'lmstudio', lastModel:'my-gemma', secrets:{ lmstudio:'encrypted-fixture' }, theme:'dark' };
  const { db, saved } = databaseFixture(old);
  const settings = db.getSettings();
  assert.equal(settings.activeProvider, 'lmstudio');
  assert.equal(settings.lastModel, 'my-gemma');
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.secrets.lmstudio, 'encrypted-fixture');
  assert.equal(settings.providers.at(-1).id, 'colibri');
  assert.deepEqual(JSON.parse(saved.get('providers')), old.providers);
});
test('saving migrated settings persists Colibri exactly once', () => {
  const { db } = databaseFixture({ providers: DEFAULT_PROVIDERS.slice(0, 2) });
  db.updateSettings({ providers: db.getSettings().providers });
  db.updateSettings({ theme: 'light' });
  assert.equal(db.getSettings().providers.filter(p => p.id === 'colibri').length, 1);
});

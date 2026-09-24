const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Palantir } = require('../src/main/palantir');

function withFetch(fn) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{}');
  };
  return fn(sent).finally(() => {
    globalThis.fetch = original;
  });
}

test('batches events to palantir.southbag.cc and identifies by Identity sub', () =>
  withFetch(async (sent) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palantir-'));
    const palantir = new Palantir();
    palantir.configure({ dataDir, version: '9.9.9' });
    palantir.enabled = true;
    palantir.capture('terminal_tab_opened', { open_tabs: 1, dropped: undefined });
    palantir.identify({ sub: 'user-1', email: 'kevin@southbag.cc' });
    palantir.capture('terminal_tab_closed');
    await palantir.flush();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://palantir.southbag.cc/batch/');
    const [opened, identify, closed] = sent[0].body.batch;
    assert.equal(opened.properties.southbag_app, 'terminal');
    assert.equal(opened.properties.app_version, '9.9.9');
    assert.equal('dropped' in opened.properties, false);
    const anonymous = fs.readFileSync(path.join(dataDir, 'palantir-id'), 'utf8').trim();
    assert.equal(opened.distinct_id, anonymous);
    assert.equal(identify.event, '$identify');
    assert.equal(identify.properties.$anon_distinct_id, anonymous);
    assert.equal(closed.distinct_id, 'user-1');

    palantir.reset();
    palantir.capture('terminal_signed_out');
    await palantir.flush();
    assert.equal(sent[1].body.batch[0].distinct_id, anonymous);
  }));

test('network failures never throw', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const palantir = new Palantir();
    palantir.configure({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'palantir-')), version: '1' });
    palantir.enabled = true;
    palantir.capture('terminal_app_launched');
    await palantir.flush();
  } finally {
    globalThis.fetch = original;
  }
});

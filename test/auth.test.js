const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// A stand-in for identity.southbag.cc that approves everyone instantly.
const seen = [];
let codeChallenge;
const identity = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let body = '';
  for await (const chunk of req) body += chunk;
  seen.push(url.pathname);
  const json = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  switch (url.pathname) {
    case '/api/auth/oauth2/register': {
      const request = JSON.parse(body);
      assert.equal(request.token_endpoint_auth_method, 'none');
      assert.match(request.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      return json(200, { client_id: 'client-1' });
    }
    case '/api/auth/oauth2/authorize': {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      codeChallenge = url.searchParams.get('code_challenge');
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'code-1');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    case '/api/auth/oauth2/token': {
      const params = new URLSearchParams(body);
      if (params.get('grant_type') === 'authorization_code') {
        const expected = crypto.createHash('sha256').update(params.get('code_verifier')).digest('base64url');
        assert.equal(expected, codeChallenge);
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
      }
      if (params.get('grant_type') === 'refresh_token' && params.get('refresh_token') === 'refresh-1') {
        return json(200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
      }
      return json(400, { error: 'invalid_grant' });
    }
    case '/api/auth/oauth2/userinfo':
      if (['Bearer access-1', 'Bearer access-2'].includes(req.headers.authorization)) {
        return json(200, { sub: 'user-1', email: 'kevin@southbag.cc', name: 'Kevin' });
      }
      return json(401, {});
    case '/api/auth/oauth2/revoke':
      return json(200, {});
    default:
      return json(404, {});
  }
});

let SouthbagAuth;
test.before(async () => {
  await new Promise((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env.SOUTHBAG_IDENTITY_URL = `http://127.0.0.1:${identity.address().port}`;
  ({ SouthbagAuth } = require('../src/main/auth'));
});
test.after(() => identity.close());

const browser = (url) => fetch(url).then(() => {});
const newAuth = (dataDir, events = []) =>
  new SouthbagAuth({ dataDir, openExternal: browser, track: (event) => events.push(event) });

test('logs in through the browser, then restores and refreshes the saved session', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const events = [];
  const user = await newAuth(dataDir, events).login();
  assert.deepEqual(user, { sub: 'user-1', email: 'kevin@southbag.cc', name: 'Kevin', picture: null });
  assert.deepEqual(events, ['terminal_login_started', 'terminal_oauth_client_registered', 'terminal_login_completed']);

  // A fresh process picks the session back up without the browser.
  const restored = newAuth(dataDir);
  assert.equal((await restored.restore()).sub, 'user-1');

  // Expired access token → refresh on restore.
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'session.json'), 'utf8'));
  fs.writeFileSync(path.join(dataDir, 'session.json'), JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }));
  const refreshedEvents = [];
  const refreshed = newAuth(dataDir, refreshedEvents);
  assert.equal((await refreshed.restore()).email, 'kevin@southbag.cc');
  assert.equal(refreshed.session.accessToken, 'access-2');
  assert.ok(refreshedEvents.includes('terminal_token_refreshed'));

  // The registered client is reused on the next login.
  seen.length = 0;
  await newAuth(dataDir).login();
  assert.equal(seen.includes('/api/auth/oauth2/register'), false);

  await refreshed.logout();
  assert.equal(fs.existsSync(path.join(dataDir, 'session.json')), false);
  assert.equal(await newAuth(dataDir).restore(), null);
});

test('a rejected session is discarded', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  fs.writeFileSync(
    path.join(dataDir, 'session.json'),
    JSON.stringify({ accessToken: 'stolen', refreshToken: 'nope', clientId: 'client-1', expiresAt: Date.now() + 1e6 }),
  );
  assert.equal(await newAuth(dataDir).restore(), null);
  assert.equal(fs.existsSync(path.join(dataDir, 'session.json')), false);
});

test('an unreachable Identity keeps the terminal locked but keeps the saved session', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  await newAuth(dataDir).login();
  const auth = newAuth(dataDir);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    await assert.rejects(auth.restore(), { code: 'network' });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(auth.user, null);
  assert.equal(fs.existsSync(path.join(dataDir, 'session.json')), true);
});

test('login can be cancelled', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const auth = new SouthbagAuth({ dataDir, openExternal: async () => setImmediate(() => auth.cancelLogin()) });
  await assert.rejects(auth.login(), { code: 'cancelled' });
});

/**
 * Sign in with Southbag Identity. Same OAuth 2.1 + PKCE flow as Southbag Online Banking
 * (`banking/worker.js`) and Southbag Code (`utils/oauth/southbag.ts`), adapted for a native
 * app per RFC 8252: the system browser does the sign-in and redirects back to a loopback
 * server on 127.0.0.1, and the OAuth client is registered dynamically with Identity the
 * first time a given redirect URI is used, then remembered.
 *
 * The terminal will not start a shell until this has produced a verified Southbag account.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ISSUER = process.env.SOUTHBAG_IDENTITY_URL || 'https://identity.southbag.cc';
const ENDPOINTS = {
  authorize: `${ISSUER}/api/auth/oauth2/authorize`,
  token: `${ISSUER}/api/auth/oauth2/token`,
  register: `${ISSUER}/api/auth/oauth2/register`,
  userinfo: `${ISSUER}/api/auth/oauth2/userinfo`,
  revoke: `${ISSUER}/api/auth/oauth2/revoke`,
};
const SCOPE = 'openid profile email offline_access';
const CLIENT_NAME = 'Southbag Terminal';
/** Tried in order so the redirect URI (and therefore the registered client) stays stable. */
const PREFERRED_PORTS = [47619, 47620, 47621];
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const EXPIRY_SKEW_MS = 60_000;

const base64url = (buffer) => buffer.toString('base64url');
const random = () => base64url(crypto.randomBytes(32));
const challengeFor = (verifier) => base64url(crypto.createHash('sha256').update(verifier).digest());

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Persists small JSON blobs under the user-data dir. Secrets are encrypted with the OS
 * keychain via Electron's safeStorage when it is available.
 */
class SecureStore {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safeStorage = safeStorage;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  read(name) {
    try {
      const raw = fs.readFileSync(this.file(name));
      if (raw.subarray(0, 4).toString() === 'enc:') {
        if (!this.safeStorage?.isEncryptionAvailable()) return null;
        return JSON.parse(this.safeStorage.decryptString(raw.subarray(4)));
      }
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }

  write(name, value, { secret = false } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    const json = JSON.stringify(value);
    const data =
      secret && this.safeStorage?.isEncryptionAvailable()
        ? Buffer.concat([Buffer.from('enc:'), this.safeStorage.encryptString(json)])
        : Buffer.from(json, 'utf8');
    fs.writeFileSync(this.file(name), data, { mode: 0o600 });
  }

  remove(name) {
    try {
      fs.rmSync(this.file(name), { force: true });
    } catch {}
  }
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: response.ok, status: response.status, body, text };
}

function callbackPage(ok, message) {
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Southbag Terminal</title>
<style>
body{font-family:"Times New Roman",serif;background:#fff;color:#000;padding:30px}
h1{color:${ok ? '#0d6efd' : '#b3261e'};text-shadow:2px 2px 4px rgba(0,0,0,.5)}
.box{border:4px double #ff9800;background:#fff8e1;padding:16px;max-width:560px;box-shadow:0 10px 20px rgba(0,0,0,.3)}
small{display:block;margin-top:24px;font-size:9px;color:#546e7a}
</style></head><body>
<h1>${ok ? 'You are now logged in to Southbag Terminal' : 'Southbag Terminal could not log you in'}</h1>
<div class="box"><p>${escape(message)}</p></div>
<small>Southbag Global Enterprise Network. This window may be monitored for quality and compliance purposes.</small>
</body></html>`;
}

class SouthbagAuth {
  /**
   * @param {object} options
   * @param {string} options.dataDir
   * @param {object} [options.safeStorage]  Electron safeStorage
   * @param {(url: string) => Promise<void>} options.openExternal
   * @param {(event: string, props?: object) => void} [options.track]
   */
  constructor({ dataDir, safeStorage, openExternal, track }) {
    this.store = new SecureStore(dataDir, safeStorage);
    this.openExternal = openExternal;
    this.track = track || (() => {});
    this.session = null;
    this.pending = null;
  }

  get user() {
    return this.session?.user ?? null;
  }

  /** Re-open the saved session, refreshing and re-verifying it with Identity. */
  async restore() {
    const saved = this.store.read('session.json');
    if (!saved?.accessToken) return null;
    this.session = saved;
    try {
      const expired = Boolean(saved.expiresAt && Date.now() > saved.expiresAt - EXPIRY_SKEW_MS);
      if (expired) await this.refresh();
      const user = await this.fetchUser();
      this.session.user = user;
      this.persist();
      this.track('terminal_session_restored', { refreshed: expired });
      return user;
    } catch (error) {
      if (error instanceof AuthError && error.code === 'unauthorized' && this.session?.refreshToken) {
        try {
          await this.refresh();
          const user = await this.fetchUser();
          this.session.user = user;
          this.persist();
          this.track('terminal_session_restored', { refreshed: true });
          return user;
        } catch {}
      }
      if (error instanceof AuthError && error.code === 'network') {
        // Identity is unreachable. We cannot verify the account, so no terminal for you.
        this.track('terminal_session_restore_failed', { reason: 'network' });
        this.session = null;
        throw error;
      }
      this.track('terminal_session_restore_failed', { reason: error.code || 'unknown' });
      this.clear();
      return null;
    }
  }

  /** Full browser sign-in. Resolves with the Identity user. */
  async login() {
    if (this.pending) {
      if (this.pending.url) await this.openExternal(this.pending.url);
      return this.pending.promise;
    }
    const started = Date.now();
    this.track('terminal_login_started');
    const run = this.runLogin();
    this.pending = { url: null, promise: run, cancel: null };
    try {
      const user = await run;
      this.track('terminal_login_completed', { duration_ms: Date.now() - started });
      return user;
    } catch (error) {
      this.track('terminal_login_failed', {
        reason: error.code || 'unknown',
        message: error.message,
        duration_ms: Date.now() - started,
      });
      throw error;
    } finally {
      this.pending = null;
    }
  }

  cancelLogin() {
    this.pending?.cancel?.(new AuthError('Login cancelled', 'cancelled'));
  }

  async runLogin() {
    const { server, port } = await this.listen();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    let timeout;
    try {
      const clientId = await this.clientFor(redirectUri);
      const state = random();
      const nonce = random();
      const verifier = random();

      const callback = new Promise((resolve, reject) => {
        this.pending.cancel = reject;
        timeout = setTimeout(() => reject(new AuthError('Login timed out', 'timeout')), LOGIN_TIMEOUT_MS);
        server.on('request', (request, response) => {
          const url = new URL(request.url || '/', redirectUri);
          if (url.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
          }
          const error = url.searchParams.get('error');
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const ok = !error && code && returnedState === state;
          response.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
          response.end(
            callbackPage(
              ok,
              ok
                ? 'You can close this tab and return to Southbag Terminal.'
                : url.searchParams.get('error_description') || error || 'The login response was invalid.',
            ),
          );
          if (ok) resolve(code);
          else if (returnedState !== state && !error) reject(new AuthError('OAuth state mismatch', 'state_mismatch'));
          else reject(new AuthError(url.searchParams.get('error_description') || error || 'Missing code', error || 'invalid_callback'));
        });
      });

      const authorize = new URL(ENDPOINTS.authorize);
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        nonce,
        code_challenge: challengeFor(verifier),
        code_challenge_method: 'S256',
        prompt: 'consent',
      }).toString();
      this.pending.url = authorize.toString();
      await this.openExternal(this.pending.url);

      const code = await callback;
      const tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      this.session = { ...tokens, clientId };
      this.session.user = await this.fetchUser();
      this.persist();
      return this.session.user;
    } finally {
      clearTimeout(timeout);
      server.close();
    }
  }

  async listen() {
    const tryPort = (port) =>
      new Promise((resolve, reject) => {
        const server = http.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
      });
    for (const port of PREFERRED_PORTS) {
      try {
        return await tryPort(port);
      } catch {}
    }
    return tryPort(0);
  }

  /** Dynamically registered public client per redirect URI, remembered across launches. */
  async clientFor(redirectUri) {
    const clients = this.store.read('clients.json') || {};
    const key = `${ISSUER} ${redirectUri}`;
    if (clients[key]) return clients[key];
    let result;
    try {
      result = await requestJson(ENDPOINTS.register, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: CLIENT_NAME,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          scope: SCOPE,
        }),
      });
    } catch (error) {
      throw new AuthError(`Could not reach Southbag Identity: ${error.message}`, 'network');
    }
    if (!result.ok || !result.body.client_id) {
      throw new AuthError(
        result.body.error_description || result.body.error || 'Identity client registration failed',
        'registration_failed',
      );
    }
    clients[key] = result.body.client_id;
    this.store.write('clients.json', clients);
    this.track('terminal_oauth_client_registered');
    return result.body.client_id;
  }

  async tokenRequest(params) {
    let result;
    try {
      result = await requestJson(ENDPOINTS.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ISSUER },
        body: new URLSearchParams(params),
      });
    } catch (error) {
      throw new AuthError(`Could not reach Southbag Identity: ${error.message}`, 'network');
    }
    const body = result.body;
    if (!result.ok || !body.access_token) {
      throw new AuthError(
        body.error_description || body.error || `Token exchange failed (${result.status})`,
        result.status === 400 || result.status === 401 ? 'unauthorized' : 'token_failed',
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || params.refresh_token || null,
      idToken: body.id_token || null,
      expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
      refreshedAt: Date.now(),
    };
  }

  async refresh() {
    if (!this.session?.refreshToken || !this.session.clientId) {
      throw new AuthError('No refresh token', 'unauthorized');
    }
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: this.session.clientId,
      refresh_token: this.session.refreshToken,
    });
    this.session = { ...this.session, ...tokens };
    this.persist();
    this.track('terminal_token_refreshed');
  }

  async fetchUser() {
    let result;
    try {
      result = await requestJson(ENDPOINTS.userinfo, {
        headers: { authorization: `Bearer ${this.session.accessToken}` },
      });
    } catch (error) {
      throw new AuthError(`Could not reach Southbag Identity: ${error.message}`, 'network');
    }
    if (result.status === 401 || result.status === 403) throw new AuthError('Session expired', 'unauthorized');
    if (!result.ok || !result.body.sub) throw new AuthError('Could not load Southbag profile', 'userinfo_failed');
    const { sub, email, name, picture } = result.body;
    return { sub, email: email || null, name: name || null, picture: picture || null };
  }

  /** Keeps the session alive while the app runs; returns false once Identity rejects us. */
  async ensureFresh() {
    if (!this.session) return false;
    if (this.session.expiresAt && Date.now() > this.session.expiresAt - EXPIRY_SKEW_MS) {
      try {
        await this.refresh();
      } catch (error) {
        if (error.code === 'network') return true;
        this.clear();
        return false;
      }
    }
    return true;
  }

  async logout() {
    const session = this.session;
    this.clear();
    this.track('terminal_logout');
    if (session?.refreshToken && session.clientId) {
      try {
        await requestJson(ENDPOINTS.revoke, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ISSUER },
          body: new URLSearchParams({
            token: session.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: session.clientId,
          }),
        });
      } catch {}
    }
  }

  persist() {
    if (this.session) this.store.write('session.json', this.session, { secret: true });
  }

  clear() {
    this.session = null;
    this.store.remove('session.json');
  }
}

module.exports = { SouthbagAuth, SecureStore, AuthError, callbackPage, challengeFor, ISSUER, ENDPOINTS };

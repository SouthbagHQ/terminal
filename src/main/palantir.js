/**
 * Palantir — Southbag's PostHog wiring for the desktop terminal. Mirrors `palantir.ts` in
 * Southbag Code (CLI) and `palantir.js` in the web apps: same project key, same
 * `palantir.southbag.cc` proxy, same `southbag_app` super property, and the person is
 * identified by their Southbag Identity `sub` so they join up across every Southbag product.
 *
 * Events are batched in memory in the main process and posted with plain fetch. The
 * renderer never talks to PostHog directly; it forwards events over IPC.
 *
 * Only names, counts, sizes and durations are ever sent — never keystrokes, commands,
 * terminal output, clipboard contents, paths or environment variables.
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PALANTIR_KEY = 'phc_rStyYsw4wrB8MwXEsPBJjz57uipHycNVwFPaw2m3aYXo';
const PALANTIR_HOST = 'https://palantir.southbag.cc';
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT = 20;
const REQUEST_TIMEOUT_MS = 4_000;

function compact(properties) {
  const result = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

class Palantir {
  constructor() {
    this.enabled = false;
    this.queue = [];
    this.timer = undefined;
    this.inflight = undefined;
    this.anonymousId = '';
    this.distinctId = '';
    this.identified = false;
    this.base = {};
    this.sessionId = randomUUID();
    this.startedAt = Date.now();
  }

  /** Set up once the app knows where its user data lives. */
  configure({ dataDir, version }) {
    this.enabled = !process.env.SOUTHBAG_PALANTIR_DISABLED;
    this.anonymousId = this.loadAnonymousId(dataDir);
    this.distinctId = this.anonymousId;
    this.base = {
      $lib: 'palantir-desktop',
      $lib_version: version,
      $session_id: this.sessionId,
      southbag_app: 'terminal',
      source: 'desktop',
      app_version: version,
      electron_version: process.versions.electron,
      chrome_version: process.versions.chrome,
      os: process.platform,
      os_release: os.release(),
      arch: process.arch,
    };
  }

  setBase(properties) {
    Object.assign(this.base, compact(properties));
  }

  /** Link this install's anonymous id to the signed-in Southbag account. */
  identify(user) {
    if (!this.enabled || !user) return;
    const id = user.sub || user.email;
    if (!id) return;
    if (this.identified && this.distinctId === id) return;
    this.distinctId = id;
    this.identified = true;
    this.enqueue('$identify', {
      $anon_distinct_id: this.anonymousId,
      $set: compact({ email: user.email, name: user.name, southbag_terminal: true }),
    });
  }

  /** Back to the anonymous install id after sign-out. */
  reset() {
    this.identified = false;
    this.distinctId = this.anonymousId;
  }

  capture(event, properties = {}) {
    if (!this.enabled || typeof event !== 'string' || !event) return;
    this.enqueue(event, properties);
  }

  error(source, error, extra = {}) {
    this.capture('terminal_error', {
      source,
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      ...extra,
    });
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inflight) await this.inflight;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.inflight = this.send(batch).finally(() => {
      this.inflight = undefined;
    });
    await this.inflight;
  }

  enqueue(event, properties) {
    this.queue.push({
      event,
      distinct_id: this.distinctId,
      timestamp: new Date().toISOString(),
      properties: {
        ...this.base,
        $process_person_profile: true,
        session_duration_ms: Date.now() - this.startedAt,
        ...compact(properties),
      },
    });
    if (this.queue.length >= FLUSH_AT) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  async send(batch) {
    try {
      await fetch(`${PALANTIR_HOST}/batch/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: PALANTIR_KEY, batch }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Telemetry must never surface as a failure; dropped events are fine.
    }
  }

  loadAnonymousId(dataDir) {
    const file = path.join(dataDir, 'palantir-id');
    try {
      if (fs.existsSync(file)) {
        const saved = fs.readFileSync(file, 'utf8').trim();
        if (saved) return saved;
      }
      const id = randomUUID();
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, `${id}\n`, 'utf8');
      return id;
    } catch {
      return randomUUID();
    }
  }
}

/** Process-wide singleton. */
const palantir = new Palantir();

module.exports = { palantir, Palantir, compact };

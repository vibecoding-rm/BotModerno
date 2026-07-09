// tests/helpers/fakes.js — dobles de prueba para D1, KV y el API de Telegram

// FakeD1: se programan respuestas por fragmento de SQL; registra cada query ejecutada.
export class FakeD1 {
  constructor() {
    this.queries = [];   // { sql, params }
    this.responses = []; // { match, first?, all?, error? }
  }
  // match: substring del SQL. first/all: valor a devolver. error: lanza al ejecutar.
  when(match, response) {
    this.responses.push({ match, ...response });
    return this;
  }
  _find(sql) {
    return this.responses.find(r => sql.includes(r.match));
  }
  prepare(sql) {
    const db = this;
    const stmt = {
      params: [],
      bind(...params) { this.params = params; return this; },
      async first() {
        db.queries.push({ sql, params: this.params });
        const r = db._find(sql);
        if (r?.error) throw new Error(r.error);
        return r?.first ?? null;
      },
      async all() {
        db.queries.push({ sql, params: this.params });
        const r = db._find(sql);
        if (r?.error) throw new Error(r.error);
        return { results: r?.all ?? [] };
      },
      async run() {
        db.queries.push({ sql, params: this.params });
        const r = db._find(sql);
        if (r?.error) throw new Error(r.error);
        return { success: true };
      }
    };
    return stmt;
  }
  ran(match) {
    return this.queries.filter(q => q.sql.includes(match));
  }
}

export class FakeKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, String(value)); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async delete(key) { this.store.delete(key); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
  }
}

// Intercepta fetch al API de Telegram; registra { method, payload } y responde ok.
export function stubTelegramFetch() {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = String(url).split('/').pop();
    let payload = null;
    try { payload = JSON.parse(opts.body); } catch { payload = opts.body; }
    calls.push({ method, payload });
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, result: {} }; }
    };
  };
  return calls;
}

export function fakeEnv(overrides = {}) {
  return {
    BOT_TOKEN: 'test-token',
    TG_WEBHOOK_SECRET: 'secreto-de-pruebas',
    ADMIN_TG_IDS: '111',
    ALLOWED_CHAT_IDS: '-100200300',
    DB: new FakeD1(),
    APP_KV: new FakeKV(),
    ...overrides
  };
}

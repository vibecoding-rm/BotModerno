// tests/moderation.unit.test.js — flujo de moderación con dobles de D1/KV/Telegram
import { SimpleTelegramBot } from '../src/bot-simple.js';
import { handleModCallback, notifySubscribers, drainPendingNotifications } from '../src/moderation.js';
import { fakeEnv, FakeD1, stubTelegramFetch } from './helpers/fakes.js';

const ADMIN = 111;
const CHAT = -100200300;

const phone = (over = {}) => ({
  id: 42, commercial_name: 'Samsung Galaxy A02s Boost', model: 'A025U',
  works: 1, bands: '["B3"]', provinces: '["La Habana"]', observations: null,
  status: 'pending', created_at: '2026-07-09', ...over
});

let tg;
beforeEach(() => { tg = stubTelegramFetch(); });

function makeBot(db) {
  return new SimpleTelegramBot(fakeEnv({ DB: db }));
}

describe('handleModCallback', () => {
  test('approve: actualiza status, encola notificaciones y muestra el siguiente', async () => {
    const db = new FakeD1()
      .when('SELECT * FROM phones WHERE id', { first: phone() })
      .when('UPDATE phones SET status', {})
      .when('INSERT INTO pending_notifications', {})
      .when("COUNT(*) AS n FROM phones WHERE status = 'pending'", { first: { n: 0 } });
    const bot = makeBot(db);

    await handleModCallback(bot, CHAT, ADMIN, 'mod:approve:42', { message_id: 7 });

    const update = db.ran('UPDATE phones SET status')[0];
    expect(update.params).toEqual(['approved', 42]);
    expect(db.ran('INSERT INTO pending_notifications').length).toBe(1);
    // editó el mensaje con el veredicto y anunció que no quedan pendientes
    expect(tg.some(c => c.method === 'editMessageText' && c.payload.text.includes('APROBADO'))).toBe(true);
    expect(tg.some(c => c.method === 'sendMessage' && c.payload.text.includes('No hay propuestas'))).toBe(true);
  });

  test('reject: no encola notificaciones', async () => {
    const db = new FakeD1()
      .when('SELECT * FROM phones WHERE id', { first: phone() })
      .when('UPDATE phones SET status', {})
      .when("COUNT(*) AS n FROM phones WHERE status = 'pending'", { first: { n: 0 } });
    const bot = makeBot(db);

    await handleModCallback(bot, CHAT, ADMIN, 'mod:reject:42', { message_id: 7 });

    expect(db.ran('UPDATE phones SET status')[0].params).toEqual(['rejected', 42]);
    expect(db.ran('INSERT INTO pending_notifications').length).toBe(0);
  });

  test('no-admin: no toca la base', async () => {
    const db = new FakeD1().when('SELECT * FROM phones WHERE id', { first: phone() });
    const bot = makeBot(db);

    await handleModCallback(bot, CHAT, 999, 'mod:approve:42', { message_id: 7 });

    expect(db.queries.length).toBe(0);
  });

  test('propuesta ya revisada: avisa y no re-aprueba', async () => {
    const db = new FakeD1()
      .when('SELECT * FROM phones WHERE id', { first: phone({ status: 'approved' }) });
    const bot = makeBot(db);

    await handleModCallback(bot, CHAT, ADMIN, 'mod:approve:42', { message_id: 7 });

    expect(db.ran('UPDATE phones SET status').length).toBe(0);
    expect(tg.some(c => c.method === 'sendMessage' && c.payload.text.includes('ya fue revisada'))).toBe(true);
  });

  test('propuesta inexistente: avisa', async () => {
    const db = new FakeD1().when('SELECT * FROM phones WHERE id', { first: null });
    const bot = makeBot(db);

    await handleModCallback(bot, CHAT, ADMIN, 'mod:approve:42', { message_id: 7 });

    expect(tg.some(c => c.method === 'sendMessage' && c.payload.text.includes('ya no existe'))).toBe(true);
  });
});

describe('notifySubscribers', () => {
  test('encola con texto escapado en HTML', async () => {
    const db = new FakeD1().when('INSERT INTO pending_notifications', {});
    const bot = makeBot(db);

    await notifySubscribers(bot, phone({ commercial_name: 'X<b>&' }));

    const q = db.ran('INSERT INTO pending_notifications')[0];
    expect(q.params[0]).toContain('X&lt;b&gt;&amp;');
  });
});

describe('drainPendingNotifications', () => {
  test('envía el lote y borra las filas enviadas', async () => {
    const db = new FakeD1()
      .when('SELECT id, tg_id, payload FROM pending_notifications', {
        all: [{ id: 1, tg_id: '5', payload: 'hola' }, { id: 2, tg_id: '6', payload: 'hola' }]
      })
      .when('DELETE FROM pending_notifications', {});
    const bot = makeBot(db);

    await drainPendingNotifications(bot);

    expect(tg.filter(c => c.method === 'sendMessage').length).toBe(2);
    expect(db.ran('DELETE FROM pending_notifications WHERE id IN (1,2)').length).toBe(1);
  });

  test('cola vacía: no envía ni borra nada', async () => {
    const db = new FakeD1().when('SELECT id, tg_id, payload FROM pending_notifications', { all: [] });
    const bot = makeBot(db);

    await drainPendingNotifications(bot);

    expect(tg.length).toBe(0);
    expect(db.ran('DELETE').length).toBe(0);
  });
});

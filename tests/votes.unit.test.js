// tests/votes.unit.test.js — votos 👍/👎 por ficha (toggle + conteo)
import { getVoteTallies, handleVoteCallback } from '../src/votes.js';
import { showPhoneDetail } from '../src/search.js';
import { SimpleTelegramBot } from '../src/bot-simple.js';
import { fakeEnv, FakeD1, stubTelegramFetch } from './helpers/fakes.js';

const base = { id: 'c1', msg: { message_id: 9 }, chatId: -100, userId: 777 };

describe('getVoteTallies', () => {
  test('mapea filas a {up, down} por id', async () => {
    const db = new FakeD1().when('FROM phone_votes', { all: [{ phone_id: 5, up: 3, down: 1 }] });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const map = await getVoteTallies(bot, [5, 6]);
    expect(map.get(5)).toEqual({ up: 3, down: 1 });
    expect(map.has(6)).toBe(false);
  });
  test('sin ids no consulta', async () => {
    const db = new FakeD1();
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const map = await getVoteTallies(bot, []);
    expect(map.size).toBe(0);
    expect(db.queries).toHaveLength(0);
  });
});

describe('handleVoteCallback', () => {
  let tg;
  beforeEach(() => { tg = stubTelegramFetch(); });

  test('voto nuevo inserta y confirma', async () => {
    const db = new FakeD1().when('SELECT vote FROM phone_votes', { first: null });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    await handleVoteCallback(bot, { ...base, data: 'vt:u:5::' });
    expect(db.ran('INSERT INTO phone_votes')).toHaveLength(1);
    const ans = tg.find(c => c.method === 'answerCallbackQuery');
    expect(ans.payload.text).toContain('Registrado');
  });

  test('mismo voto de nuevo lo quita (toggle)', async () => {
    const db = new FakeD1().when('SELECT vote FROM phone_votes', { first: { vote: 1 } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    await handleVoteCallback(bot, { ...base, data: 'vt:u:5::' });
    expect(db.ran('DELETE FROM phone_votes')).toHaveLength(1);
    expect(db.ran('INSERT INTO phone_votes')).toHaveLength(0);
    const ans = tg.find(c => c.method === 'answerCallbackQuery');
    expect(ans.payload.text).toContain('Quité');
  });

  test('cambiar de 👎 a 👍 hace upsert (no borra)', async () => {
    const db = new FakeD1().when('SELECT vote FROM phone_votes', { first: { vote: -1 } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    await handleVoteCallback(bot, { ...base, data: 'vt:u:5::' });
    expect(db.ran('INSERT INTO phone_votes')).toHaveLength(1);
    expect(db.ran('DELETE FROM phone_votes')).toHaveLength(0);
  });

  test('dirección desconocida no vota', async () => {
    const db = new FakeD1();
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    await handleVoteCallback(bot, { ...base, data: 'vt:x:5:0:samsung' });
    expect(db.ran('phone_votes')).toHaveLength(0);
    expect(tg.find(c => c.method === 'answerCallbackQuery')).toBeTruthy();
  });
});

describe('showPhoneDetail', () => {
  test('muestra el nombre completo, conteo y botones de voto + volver', async () => {
    const db = new FakeD1()
      .when('FROM phones WHERE id', { first: { id: 5, commercial_name: 'Samsung Galaxy A02s', model: 'SM-A025M', works: 1, bands: '[]', provinces: '[]', observations: 'Anda de lujo' } })
      .when('FROM phone_votes WHERE phone_id', { all: [{ phone_id: 5, up: 2, down: 1 }] });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const tg = stubTelegramFetch();
    await showPhoneDetail(bot, -100, 5, 0, 'samsung');
    const sent = tg.find(c => c.method === 'sendMessage');
    expect(sent.payload.text).toContain('Samsung Galaxy A02s');
    expect(sent.payload.text).toContain('Funciona en Cuba');
    const kb = JSON.stringify(sent.payload.reply_markup.inline_keyboard);
    expect(kb).toContain('👍 2');
    expect(kb).toContain('👎 1');
    expect(kb).toContain('Volver');
  });
});

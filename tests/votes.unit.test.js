// tests/votes.unit.test.js — votos 👍/👎 por ficha (toggle + conteo)
import { getVoteTallies, handleVoteCallback } from '../src/votes.js';
import { showPhoneDetail, searchByModel } from '../src/search.js';
import { cubaBandVerdict, normDeviceName } from '../src/format.js';
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
    // works=true (confirmado): NO se muestra el estimado por bandas (comunidad manda)
    expect(sent.payload.text).not.toContain('Estimado por sus bandas');
    const kb = JSON.stringify(sent.payload.reply_markup.inline_keyboard);
    expect(kb).toContain('👍 2');
    expect(kb).toContain('👎 1');
    expect(kb).toContain('Volver');
  });

  test('con works desconocido incluye el veredicto de bandas (B3)', async () => {
    const db = new FakeD1()
      .when('FROM phones WHERE id', { first: { id: 7, commercial_name: 'Samsung Galaxy A57', model: 'SM-A576', works: null, bands: '[]', provinces: '[]', observations: '' } })
      .when('FROM phone_votes WHERE phone_id', { all: [] })
      .when('FROM device_bands WHERE norm_name = ', { first: { bands_4g: '1, 3, 7, 20' } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const tg = stubTelegramFetch();
    await showPhoneDetail(bot, -100, 7, 0, 'galaxy a57');
    const t = tg.find(c => c.method === 'sendMessage').payload.text;
    expect(t).toContain('Compatible con el 4G de Cuba');
    expect(t).toContain('LTE B3');
    expect(t).toContain('NO probado');
  });
});

describe('/revisar fallback a bandas (modelo no testeado)', () => {
  test('sin resultados en la comunidad muestra el estimado por bandas', async () => {
    const db = new FakeD1()
      .when('phones_fts MATCH', { first: { n: 0 } })
      .when("FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE", { first: { n: 0 } })
      .when('FROM device_bands WHERE norm_name LIKE', { all: [{ oem: 'Samsung', model: 'Galaxy A54 5G', bands_2g: 'GSM 900', bands_3g: '900 / 2100', bands_4g: '1, 3, 7, 20, 28' }] });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const tg = stubTelegramFetch();
    await searchByModel(bot, -100, 'galaxy a54');
    const t = tg.find(c => c.method === 'sendMessage').payload.text;
    expect(t).toContain('Nadie de la comunidad ha reportado');
    expect(t).toContain('Galaxy A54');
    expect(t).toContain('Estimado por las bandas');
  });
});

describe('cubaBandVerdict', () => {
  test('B3 presente -> compatible', () => {
    const v = cubaBandVerdict({ bands_4g: '1, 3, 7, 20' });
    expect(v.level).toBe('ok');
    expect(v.text).toContain('Compatible con el 4G de Cuba');
    expect(v.text).toContain('LTE B3');
    expect(v.text).toContain('NO probado');
  });
  test('sin B3 pero con B1/B28 -> 4G parcial', () => {
    const v = cubaBandVerdict({ bands_4g: '1, 2, 4, 28' });
    expect(v.level).toBe('partial');
    expect(v.text).toContain('parcial');
    expect(v.short).toContain('B1/B28');
  });
  test('LTE sin ninguna banda de ETECSA -> sin 4G', () => {
    const v = cubaBandVerdict({ bands_4g: '2, 4, 5, 12', bands_2g: 'GSM 900' });
    expect(v.level).toBe('none');
    expect(v.text).toContain('sin 4G');
    expect(v.text).toContain('llamadas'); // tiene GSM 900
  });
  test('sin números de banda o sin fila -> null (no estimamos)', () => {
    expect(cubaBandVerdict({ bands_4g: 'LTE' })).toBeNull();
    expect(cubaBandVerdict(null)).toBeNull();
  });
});

describe('normDeviceName', () => {
  test('normaliza para el cruce (minúsculas, sin símbolos, sin acentos)', () => {
    expect(normDeviceName('Samsung Galaxy A02s')).toBe('samsung galaxy a02s');
    expect(normDeviceName('Nothing Phone (4b) 5G')).toBe('nothing phone 4b 5g');
  });
});

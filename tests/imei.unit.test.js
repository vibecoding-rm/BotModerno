// tests/imei.unit.test.js — validación de IMEI y lookup de TAC
import { normalizeImei, luhnValidImei, handleImei } from '../src/imei.js';
import { SimpleTelegramBot } from '../src/bot-simple.js';
import { fakeEnv, FakeD1, stubTelegramFetch } from './helpers/fakes.js';

describe('normalizeImei', () => {
  test('acepta 15 dígitos con separadores', () => {
    expect(normalizeImei('356759-04-123456-3')).toBe('356759041234563');
    expect(normalizeImei(' 35675904123456 ')).toBe('35675904123456'); // 14 (sin check)
  });
  test('rechaza longitudes fuera de 14-16', () => {
    expect(normalizeImei('12345')).toBeNull();
    expect(normalizeImei('1'.repeat(17))).toBeNull();
    expect(normalizeImei('')).toBeNull();
  });
});

describe('luhnValidImei', () => {
  test('valida un IMEI real (check digit correcto)', () => {
    // 49015420323751 -> check digit 8 (ejemplo clásico de la spec)
    expect(luhnValidImei('490154203237518')).toBe(true);
  });
  test('detecta check digit incorrecto', () => {
    expect(luhnValidImei('490154203237519')).toBe(false);
  });
  test('no comprobable con 14 dígitos', () => {
    expect(luhnValidImei('49015420323751')).toBeNull();
  });
});

describe('handleImei', () => {
  let tg;
  beforeEach(() => { tg = stubTelegramFetch(); });

  test('TAC conocido responde marca y modelo', async () => {
    const db = new FakeD1()
      .when('SELECT brand, model, aka FROM tacs', { first: { brand: 'Nokia', model: '1610', aka: 'NHE-5NX' } })
      .when('phones_fts MATCH', { first: { n: 0 } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));

    await handleImei(bot, -100, '490139201234563');

    const sent = tg.find(c => c.method === 'sendMessage');
    expect(sent.payload.text).toContain('Nokia 1610');
    expect(sent.payload.text).toContain('NHE-5NX');
    expect(sent.payload.text).toContain('49013920');
  });

  test('TAC desconocido lo dice y sugiere /revisar', async () => {
    const db = new FakeD1().when('SELECT brand, model, aka FROM tacs', { first: null });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));

    await handleImei(bot, -100, '990000001234567');

    const sent = tg.find(c => c.method === 'sendMessage');
    expect(sent.payload.text).toContain('no está en nuestra base');
    expect(sent.payload.text).toContain('/revisar');
  });

  test('cruce con la comunidad cuando hay registros', async () => {
    const db = new FakeD1()
      .when('SELECT brand, model, aka FROM tacs', { first: { brand: 'Samsung', model: 'Galaxy A02s', aka: '' } })
      .when('phones_fts MATCH', { first: { n: 7 } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));

    await handleImei(bot, -100, '354851092838773');

    const sent = tg.find(c => c.method === 'sendMessage');
    expect(sent.payload.text).toContain('7');
    expect(sent.payload.text).toContain('/revisar Galaxy A02s');
  });

  test('IMEI inválido (corto) da error claro', async () => {
    const bot = new SimpleTelegramBot(fakeEnv());
    await handleImei(bot, -100, '1234');
    const sent = tg.find(c => c.method === 'sendMessage');
    expect(sent.payload.text).toContain('no parece un IMEI');
  });
});

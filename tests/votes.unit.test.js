// tests/votes.unit.test.js — votos 👍/👎 por ficha (toggle + conteo)
import { getVoteTallies, handleVoteCallback } from '../src/votes.js';
import { showPhoneDetail, searchByModel } from '../src/search.js';
import { cubaBandVerdict, normDeviceName, formatBandEstimates } from '../src/format.js';
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
      .when('FROM device_bands WHERE norm_name = ', { first: { bands_4g: '1, 3, 7, 20', bands_3g: 'HSDPA 900 / 2100', bands_2g: 'GSM 900' } });
    const bot = new SimpleTelegramBot(fakeEnv({ DB: db }));
    const tg = stubTelegramFetch();
    await showPhoneDetail(bot, -100, 7, 0, 'galaxy a57');
    const t = tg.find(c => c.method === 'sendMessage').payload.text;
    expect(t).toContain('¿Funcionaría en Cuba?');
    expect(t).toContain('Internet 4G: SÍ');
    expect(t).toContain('B3 (1800 MHz)');
    expect(t).toContain('NO lo ha probado');
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
    // un solo modelo -> desglose completo, igual que /imei
    expect(t).toContain('¿Funcionaría en Cuba?');
    expect(t).toContain('Internet 4G: SÍ');
  });
});

describe('cubaBandVerdict', () => {
  test('respuesta clara SÍ + frecuencias de 4G/3G/2G', () => {
    const v = cubaBandVerdict({ bands_4g: '1, 3, 7, 20', bands_3g: 'HSDPA 900 / 2100', bands_2g: 'GSM 900' });
    expect(v.level).toBe('ok');
    expect(v.text).toContain('Internet 4G: SÍ');
    expect(v.text).toContain('B3 (1800 MHz)');
    expect(v.text).toContain('Llamadas, SMS e internet básico: SÍ');
    expect(v.text).toContain('2100'); // frecuencia 3G
    expect(v.text).toContain('2G (900 MHz)'); // frecuencia 2G
    expect(v.text).toContain('NO lo ha probado');
    expect(v.short).toContain('✅ Sí sirve');
  });
  test('sin B3 (aunque traiga B1/B28) -> NO hay 4G en Cuba', () => {
    // ETECSA da 4G HOY solo con B3 (1800); B1/B28 no están desplegadas
    const v = cubaBandVerdict({ bands_4g: '1, 2, 4, 28' });
    expect(v.text).toContain('Internet 4G: NO');
    expect(v.text).toContain('B3 (1800 MHz)');
    expect(v.short).not.toContain('4G');
  });
  test('4G no compatible pero con 2G/3G lo dice claro', () => {
    const v = cubaBandVerdict({ bands_4g: '2, 4, 5, 12', bands_3g: 'HSDPA 850 / 1900 / 2100', bands_2g: 'GSM 850 / 900' });
    expect(v.level).toBe('partial'); // sirve para llamadas/3G aunque no 4G
    expect(v.text).toContain('Internet 4G: NO');
    expect(v.text).toContain('Llamadas, SMS e internet básico: SÍ');
    expect(v.short).toContain('Solo llamadas y 3G');
  });
  test('solo 2G/3G (sin 4G) igual da veredicto con frecuencias', () => {
    const v = cubaBandVerdict({ bands_4g: 'No', bands_3g: 'UMTS 2100', bands_2g: 'GSM 900' });
    expect(v.text).toContain('Internet 4G: NO');
    expect(v.text).toContain('3G (2100 MHz)');
    expect(v.text).toContain('2G (900 MHz)');
  });
  test('sin nada que evaluar o sin fila -> null', () => {
    expect(cubaBandVerdict({ bands_4g: '', bands_3g: '', bands_2g: '' })).toBeNull();
    expect(cubaBandVerdict(null)).toBeNull();
  });
});

describe('normDeviceName', () => {
  test('normaliza para el cruce (minúsculas, sin símbolos, sin acentos)', () => {
    expect(normDeviceName('Samsung Galaxy A02s')).toBe('samsung galaxy a02s');
    expect(normDeviceName('Nothing Phone (4b) 5G')).toBe('nothing phone 4b 5g');
  });
});

describe('formatBandEstimates — multi-variante', () => {
  const b3row = { oem: 'Samsung', model: 'Galaxy S23 5G Global', bands_2g: 'GSM 900', bands_3g: 'UMTS 900 / 2100', bands_4g: 'LTE B1, B3, B7, B28' };
  // sin 2G/3G de ETECSA ni B3 → veredicto 'none' (no sirve)
  const noB3row = { oem: 'Samsung', model: 'Galaxy S23 5G US', bands_2g: 'GSM 850 / 1900', bands_3g: 'UMTS 850 / 1900', bands_4g: 'LTE B2, B5, B12' };
  const calls3G = { oem: 'Samsung', model: 'Galaxy S23 FE 3G', bands_2g: 'GSM 900', bands_3g: 'UMTS 900 / 2100', bands_4g: '' };

  test('todas ok → un solo veredicto + nota de variantes', () => {
    const variants = [
      { ...b3row, model: 'Galaxy S23 5G CA' },
      b3row,
      { ...b3row, model: 'Galaxy S23 5G KR' },
    ];
    const t = formatBandEstimates('samsung galaxy s23', variants);
    expect(t).toContain('Internet 4G: SÍ');
    expect(t).toContain('Revisamos 3 variantes');
    expect(t).not.toContain('📱');
  });

  test('preferencia por variante Global como representante', () => {
    const variants = [
      { ...b3row, model: 'Galaxy S23 5G CA' },
      b3row, // este tiene "Global" en el nombre
    ];
    const t = formatBandEstimates('samsung galaxy s23', variants);
    // el veredicto debe ser del Global (B3), no del CA
    expect(t).toContain('Internet 4G: SÍ');
  });

  test('veredictos mixtos → desglose compacto por bucket', () => {
    const t = formatBandEstimates('samsung galaxy s23', [b3row, noB3row]);
    expect(t).toContain('Sí sirve: 1 variante');
    expect(t).toContain('No sirve: 1 variante');
    expect(t).not.toContain('Revisamos');
  });

  test('mixto ok + partial → desglose correcto', () => {
    const t = formatBandEstimates('samsung galaxy s23', [b3row, calls3G]);
    expect(t).toContain('Sí sirve: 1 variante');
    expect(t).toContain('Solo llamadas/3G: 1 variante');
  });

  test('1 fila → desglose completo (sin nota de variantes)', () => {
    const t = formatBandEstimates('galaxy s23', [b3row]);
    expect(t).toContain('¿Funcionaría en Cuba?');
    expect(t).not.toContain('Revisamos');
  });
});

// tests/wizard.unit.test.js — unit tests de los helpers puros del bot
import {
  normalizeText, toUpperModel, parseYesNo, splitNormList,
  parseProvincesText, parseJsonArray, CUBA_PROVINCES,
  escapeHtml, formatSearchResults, buildFtsQuery
} from '../src/format.js';
import { kbProvinces } from '../src/keyboards.js';

describe('normalizeText', () => {
  test('quita acentos, colapsa espacios y pasa a minúsculas', () => {
    expect(normalizeText('  Camagüey   Sí ')).toBe('camaguey si');
    expect(normalizeText('HOLGUÍN')).toBe('holguin');
  });
  test('tolera null/undefined/vacío', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('')).toBe('');
  });
});

describe('toUpperModel', () => {
  test('recorta y pasa a mayúsculas', () => {
    expect(toUpperModel(' sm-a145m ')).toBe('SM-A145M');
    expect(toUpperModel(null)).toBe('');
  });
});

describe('parseYesNo', () => {
  test('acepta variantes de sí', () => {
    for (const t of ['si', 'Sí', 'S', 'yes', 'OK']) expect(parseYesNo(t)).toBe(true);
  });
  test('acepta variantes de no', () => {
    for (const t of ['no', 'N', 'cancelar']) expect(parseYesNo(t)).toBe(false);
  });
  test('devuelve null si no reconoce', () => {
    expect(parseYesNo('tal vez')).toBeNull();
    expect(parseYesNo('')).toBeNull();
  });
});

describe('splitNormList (bandas)', () => {
  test('separa por comas, espacios, ; y |', () => {
    expect(splitNormList('B3, B7 B28;B20|B38')).toEqual(['B3', 'B7', 'B28', 'B20', 'B38']);
  });
  test('vacío devuelve []', () => {
    expect(splitNormList('')).toEqual([]);
    expect(splitNormList('   ')).toEqual([]);
  });
});

describe('parseProvincesText', () => {
  test('separa SOLO por comas/;/| y respeta nombres con espacios', () => {
    expect(parseProvincesText('La Habana, Santiago de Cuba'))
      .toEqual(['La Habana', 'Santiago de Cuba']);
  });
  test('mapea al nombre canónico sin importar acentos ni mayúsculas', () => {
    expect(parseProvincesText('holguin; ciego de avila'))
      .toEqual(['Holguín', 'Ciego de Ávila']);
  });
  test('deduplica y deja pasar nombres desconocidos tal cual', () => {
    expect(parseProvincesText('Miami, La Habana, la habana'))
      .toEqual(['Miami', 'La Habana']);
  });
  test('vacío devuelve []', () => {
    expect(parseProvincesText('')).toEqual([]);
    expect(parseProvincesText('  ')).toEqual([]);
  });
});

describe('parseJsonArray', () => {
  test('parsea string JSON de array', () => {
    expect(parseJsonArray('["B3","B7"]')).toEqual(['B3', 'B7']);
  });
  test('JSON inválido o no-array devuelve []', () => {
    expect(parseJsonArray('no json')).toEqual([]);
    expect(parseJsonArray('{"a":1}')).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
  });
  test('array pasa tal cual', () => {
    expect(parseJsonArray(['x'])).toEqual(['x']);
  });
});

describe('buildFtsQuery', () => {
  test('tokeniza con prefijos y AND implícito', () => {
    expect(buildFtsQuery('samsun galax')).toBe('"samsun"* "galax"*');
  });
  test('normaliza acentos/mayúsculas y separa por no-alfanuméricos', () => {
    expect(buildFtsQuery('SM-A520L Holguín')).toBe('"sm"* "a520l"* "holguin"*');
  });
  test('neutraliza comillas y sintaxis FTS del usuario', () => {
    expect(buildFtsQuery('a"b OR c')).toBe('"a"* "b"* "or"* "c"*');
  });
  test('sin tokens utilizables devuelve null', () => {
    expect(buildFtsQuery('!!! ---')).toBeNull();
    expect(buildFtsQuery('')).toBeNull();
  });
});

describe('escapeHtml', () => {
  test('escapa &, < y >', () => {
    expect(escapeHtml('a<b> & c')).toBe('a&lt;b&gt; &amp; c');
  });
  test('tolera null/undefined y números', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
  test('deja pasar guiones bajos y asteriscos (ya no son especiales en HTML)', () => {
    expect(escapeHtml('BV4900_Pro *new*')).toBe('BV4900_Pro *new*');
  });
});

describe('formatSearchResults', () => {
  const row = (over = {}) => ({
    commercial_name: 'Redmi Note 12', model: '2209116AG', works: true,
    bands: ['B3'], provinces: ['La Habana'], observations: null, ...over
  });
  test('escapa datos de usuario en HTML', () => {
    const out = formatSearchResults('a<b', [row({ commercial_name: 'X<script>' })], 0, 1);
    expect(out).toContain('a&lt;b');
    expect(out).toContain('X&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
  test('omite el modelo cuando es idéntico al nombre', () => {
    const out = formatSearchResults('q', [row({ commercial_name: '2209116AG' })], 0, 1);
    expect(out).not.toContain('(2209116AG)');
  });
  test('agrega ❓ a la leyenda solo si hay filas sin confirmar', () => {
    expect(formatSearchResults('q', [row()], 0, 1)).not.toContain('❓');
    expect(formatSearchResults('q', [row({ works: null })], 0, 1)).toContain('❓ sin confirmar');
  });
});

describe('kbProvinces', () => {
  test('incluye las 16 provincias más filas de Listo/Omitir y Atrás/Cancelar', () => {
    const kb = kbProvinces([], '123');
    const buttons = kb.inline_keyboard.flat();
    const provinceButtons = buttons.filter(b => b.callback_data.startsWith('prov:t:'));
    expect(provinceButtons).toHaveLength(CUBA_PROVINCES.length);
    expect(buttons.some(b => b.callback_data === 'prov:done::123')).toBe(true);
    expect(buttons.some(b => b.callback_data === 'prov:skip::123')).toBe(true);
    expect(buttons.some(b => b.callback_data === 'wiz:cancel')).toBe(true);
  });
  test('marca las seleccionadas con ✅', () => {
    const kb = kbProvinces(['La Habana'], '123');
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.some(b => b.text === '✅ La Habana')).toBe(true);
    expect(buttons.some(b => b.text === 'Matanzas')).toBe(true);
  });
  test('ningún callback_data supera 64 bytes (límite de Telegram)', () => {
    const enc = new TextEncoder();
    const kb = kbProvinces(CUBA_PROVINCES, '9999999999');
    for (const b of kb.inline_keyboard.flat()) {
      expect(enc.encode(b.callback_data).length).toBeLessThanOrEqual(64);
    }
  });
});

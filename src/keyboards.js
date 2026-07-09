/* src/keyboards.js
 * Teclados inline reutilizables (solo estructuras, sin I/O).
 */
import { CUBA_PROVINCES } from './format.js';

export function kbCancel() {
  return { inline_keyboard: [[{ text: 'Cancelar', callback_data: 'wiz:cancel' }]] };
}

export function kbBackCancel() {
  return { inline_keyboard: [[
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]] };
}

export function kbWorks() {
  return { inline_keyboard: [
    [
      { text: '👍 Sí', callback_data: 'wiz:works_yes' },
      { text: '👎 No', callback_data: 'wiz:works_no' }
    ],
    [
      { text: 'Atrás', callback_data: 'wiz:back' },
      { text: 'Cancelar', callback_data: 'wiz:cancel' }
    ]
  ] };
}

export function kbConfirm() {
  return { inline_keyboard: [[
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Confirmar', callback_data: 'wiz:confirm' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]] };
}

// Teclado multi-selección de provincias; ownerId evita que otros toquen el wizard ajeno
export function kbProvinces(selected = [], ownerId = '') {
  const rows = [];
  for (let i = 0; i < CUBA_PROVINCES.length; i += 2) {
    const row = [];
    for (const j of [i, i + 1]) {
      if (j < CUBA_PROVINCES.length) {
        const name = CUBA_PROVINCES[j];
        const on = selected.includes(name);
        row.push({ text: (on ? '✅ ' : '') + name, callback_data: `prov:t:${j}:${ownerId}` });
      }
    }
    rows.push(row);
  }
  rows.push([
    { text: '✔️ Listo', callback_data: `prov:done::${ownerId}` },
    { text: 'Omitir', callback_data: `prov:skip::${ownerId}` }
  ]);
  rows.push([
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]);
  return { inline_keyboard: rows };
}

export function kbModeration(id) {
  return { inline_keyboard: [
    [
      { text: '✅ Aprobar', callback_data: `mod:approve:${id}` },
      { text: '❌ Rechazar', callback_data: `mod:reject:${id}` }
    ],
    [
      { text: '⏭ Saltar', callback_data: `mod:next:${id}` }
    ]
  ] };
}

export function kbWelcome() {
  return {
    inline_keyboard: [
      [
        { text: '📱 Agregar Teléfono', callback_data: 'welcome:add_phone' },
        { text: '🔍 Buscar Teléfonos', callback_data: 'welcome:search' }
      ],
      [
        { text: '📜 Ver Reglas', callback_data: 'welcome:rules' },
        { text: '📊 Ver Estadísticas', callback_data: 'welcome:stats' }
      ],
      [
        { text: '📥 Exportar Base', callback_data: 'welcome:export' },
        { text: '❓ Ayuda', callback_data: 'welcome:help' }
      ]
    ]
  };
}

export function kbExport() {
  return {
    inline_keyboard: [
      [
        { text: '📄 Exportar CSV', callback_data: 'export:csv' },
        { text: '📋 Exportar JSON', callback_data: 'export:json' }
      ],
      [
        { text: '📊 Solo Estadísticas', callback_data: 'export:stats' },
        { text: '📱 Solo Teléfonos', callback_data: 'export:phones' }
      ],
      [
        { text: '🔙 Volver', callback_data: 'welcome:back' }
      ]
    ]
  };
}

export function kbCaptcha(chatId, userId) {
  return {
    inline_keyboard: [[
      { text: '✅ Soy humano', callback_data: `cap:ok:${chatId}:${userId}` },
      { text: '❌ No pasar', callback_data: `cap:fail:${chatId}:${userId}` }
    ]]
  };
}

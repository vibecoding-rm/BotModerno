/* src/wizard.js
 * Asistente /subir por pasos (borrador en submission_drafts) + envío de la propuesta.
 */
import { logger } from './logger.js';
import { validate, phoneSubmissionSchema } from './validation.js';
import { normalizeText, toUpperModel, parseYesNo, splitNormList, parseProvincesText, escapeHtml, CUBA_PROVINCES } from './format.js';
import { kbCancel, kbBackCancel, kbWorks, kbConfirm, kbProvinces } from './keyboards.js';
import { notifyAdminsNewSubmission } from './moderation.js';

const STEP_NUM = {
  awaiting_name: 1, awaiting_model: 2, awaiting_works: 3,
  awaiting_bands: 4, awaiting_provinces: 5, awaiting_obs: 6
};

// Barra de progreso del wizard: "Paso 3/6 · ▰▰▰▱▱▱"
function progress(step) {
  const n = STEP_NUM[step];
  if (!n) return '';
  return `<b>Paso ${n}/6</b> · ${'▰'.repeat(n)}${'▱'.repeat(6 - n)}\n`;
}

const PROMPTS = {
  awaiting_name: 'Nombre comercial (ej: "Redmi Note 12").',
  awaiting_model: 'Modelo exacto (ej: "2209116AG").',
  awaiting_works: '¿Funciona en Cuba? Responde "sí" o "no".',
  awaiting_bands: 'Indica las bandas separadas por coma:\n\n📡 Bandas específicas: B3,B7,B28,B20,B38\n📶 Tecnologías: 2G,3G,4G,5G\n❓ O escribe "desconocido"',
  awaiting_provinces: '📍 ¿En qué provincias lo probaste? Toca para marcar/desmarcar y pulsa "✔️ Listo" (o escribe los nombres separados por coma).',
  awaiting_obs: 'Observaciones adicionales (opcional). Escribe "-" para omitir.'
};

// Prompt de un paso con su barra de progreso
function stepPrompt(step) {
  return progress(step) + PROMPTS[step];
}

export async function getDraft(bot, tgId) {
  const row = await bot.db.prepare("SELECT * FROM submission_drafts WHERE tg_id = ?1").bind(String(tgId)).first();
  if (!row) return null;
  return parseDraftRow(row);
}

function parseDraftRow(row) {
  let bands = row.bands;
  if (typeof bands === 'string') {
    try { bands = JSON.parse(bands); } catch { bands = []; }
  }
  let provinces = row.provinces;
  if (typeof provinces === 'string') {
    try { provinces = JSON.parse(provinces); } catch { provinces = []; }
  }
  return {
    ...row,
    bands: Array.isArray(bands) ? bands : [],
    provinces: Array.isArray(provinces) ? provinces : [],
    works: row.works === 1 || row.works === true ? true : (row.works === 0 || row.works === false ? false : null)
  };
}

export async function setDraft(bot, tgId, patch) {
  const existing = await getDraft(bot, tgId);
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);

  const step = has('step') ? patch.step : (existing ? existing.step : 'awaiting_name');
  const commercial_name = has('commercial_name') ? patch.commercial_name : (existing ? existing.commercial_name : null);
  const model = has('model') ? patch.model : (existing ? existing.model : null);

  const worksVal = has('works') ? patch.works : (existing ? existing.works : null);
  const works = worksVal === true ? 1 : (worksVal === false ? 0 : null);

  const bandsVal = has('bands') ? patch.bands : (existing ? existing.bands : null);
  const bands = Array.isArray(bandsVal) ? JSON.stringify(bandsVal) : (typeof bandsVal === 'string' ? bandsVal : null);

  const provincesVal = has('provinces') ? patch.provinces : (existing ? existing.provinces : null);
  const provinces = Array.isArray(provincesVal) ? JSON.stringify(provincesVal) : (typeof provincesVal === 'string' ? provincesVal : null);

  const observations = has('observations') ? patch.observations : (existing ? existing.observations : null);
  const updatedAt = new Date().toISOString();

  let row;
  if (existing) {
    row = await bot.db.prepare(
      "UPDATE submission_drafts SET step = ?1, commercial_name = ?2, model = ?3, works = ?4, bands = ?5, provinces = ?6, observations = ?7, updated_at = ?8 WHERE tg_id = ?9 RETURNING *"
    ).bind(step, commercial_name, model, works, bands, provinces, observations, updatedAt, String(tgId)).first();
  } else {
    row = await bot.db.prepare(
      "INSERT INTO submission_drafts (tg_id, step, commercial_name, model, works, bands, provinces, observations, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *"
    ).bind(String(tgId), step, commercial_name, model, works, bands, provinces, observations, updatedAt).first();
  }

  if (!row) throw new Error("Failed to save draft");
  return parseDraftRow(row);
}

export async function clearDraft(bot, tgId) {
  await bot.db.prepare("DELETE FROM submission_drafts WHERE tg_id = ?1").bind(String(tgId)).run();
}

export async function startWizard(bot, chatId, userId, replyTo) {
  await setDraft(bot, userId, { step: 'awaiting_name', commercial_name: null, model: null, works: null, bands: null, provinces: null, observations: null });
  await bot.sendMessage(chatId, progress('awaiting_name') + '📲 Vamos a subir un modelo. Dime el nombre comercial (ej: "Redmi Note 12").', {
    reply_markup: kbCancel(),
    reply_to_message_id: replyTo
  });
}

export async function cancelWizard(bot, chatId, userId) {
  await clearDraft(bot, userId);
  await bot.sendMessage(chatId, '🚫 Asistente cancelado. Empieza de nuevo cuando quieras con /subir.');
}

export async function handleWizardText(bot, chatId, userId, text, replyTo) {
  const send = (t, kb) => bot.sendMessage(chatId, t, { reply_markup: kb, reply_to_message_id: replyTo });
  try {
    const draft = await getDraft(bot, userId);
    if (!draft) return false;

    switch (draft.step) {
      case 'awaiting_name': {
        if (!text || text.length < 2) {
          await send('Por favor, envía un nombre comercial válido.', kbCancel());
          return true;
        }
        await setDraft(bot, userId, { commercial_name: text, step: 'awaiting_model' });
        await send(stepPrompt('awaiting_model'), kbBackCancel());
        return true;
      }
      case 'awaiting_model': {
        if (!text || text.length < 1) {
          await send('Modelo inválido.', kbBackCancel());
          return true;
        }
        await setDraft(bot, userId, { model: text, step: 'awaiting_works' });
        await send(stepPrompt('awaiting_works'), kbWorks());
        return true;
      }
      case 'awaiting_works': {
        const yn = parseYesNo(text);
        if (yn === null) {
          await send('Responde "sí" o "no".', kbWorks());
          return true;
        }
        if (yn) {
          await setDraft(bot, userId, { works: true, step: 'awaiting_bands' });
          await send(stepPrompt('awaiting_bands'), kbBackCancel());
        } else {
          await setDraft(bot, userId, { works: false, step: 'awaiting_obs' });
          await send(progress('awaiting_obs') + 'Añade observaciones (ej: "sin señal 4G en Holguín").', kbBackCancel());
        }
        return true;
      }
      case 'awaiting_bands': {
        const bands = text.toLowerCase() === 'desconocido' ? [] : splitNormList(text);
        await setDraft(bot, userId, { bands, provinces: [], step: 'awaiting_provinces' });
        await send(stepPrompt('awaiting_provinces'), kbProvinces([], userId));
        return true;
      }
      case 'awaiting_provinces': {
        const provinces = text === '-' ? [] : parseProvincesText(text);
        await setDraft(bot, userId, { provinces, step: 'awaiting_obs' });
        await send(stepPrompt('awaiting_obs'), kbBackCancel());
        return true;
      }
      case 'awaiting_obs': {
        const observations = text === '-' ? null : text;
        await setDraft(bot, userId, { observations, step: 'confirm' });
        const d = await getDraft(bot, userId);
        const summary =
          '📌 Resumen:\n' +
          `Nombre: ${escapeHtml(d.commercial_name)}\n` +
          `Modelo: ${escapeHtml(d.model)}\n` +
          `¿Funciona?: ${d.works ? 'Sí' : 'No'}\n` +
          `Bandas: ${escapeHtml((d.bands && d.bands.length) ? d.bands.join(', ') : '—')}\n` +
          `Provincias: ${escapeHtml((d.provinces && d.provinces.length) ? d.provinces.join(', ') : '—')}\n` +
          `Obs: ${escapeHtml(d.observations || '—')}`;
        await send(summary + '\n\nConfirma con el botón.', kbConfirm());
        return true;
      }
      case 'confirm': {
        // If user types instead of pressing buttons, accept yes/no
        const yn = parseYesNo(text);
        if (yn === null) {
          await send('Pulsa Confirmar o responde "sí" para confirmar o "no" para cancelar.', kbConfirm());
          return true;
        }
        if (yn) {
          await submitPhone(bot, userId, chatId, replyTo);
        } else {
          await cancelWizard(bot, chatId, userId);
        }
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    logger.error('handleWizardText error', e, { chatId, userId });
    await send('Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    return true;
  }
}

// Callbacks del wizard: selección de provincias (prov:) y controles (wiz:)
export async function handleProvincesCallback(bot, { id, data, msg, chatId, userId }) {
  const parts = data.split(':'); // prov:<t|done|skip>:<idx|''>:<ownerId>
  const action = parts[1];
  const ownerId = parts[3];
  if (ownerId && String(userId) !== ownerId) {
    await bot.answerCallbackQuery(id, { text: 'Este asistente es de otro usuario.', show_alert: false });
    return;
  }
  await bot.answerCallbackQuery(id);
  const draft = await getDraft(bot, userId);
  if (!draft || draft.step !== 'awaiting_provinces') return;

  if (action === 'done' || action === 'skip') {
    const provinces = action === 'skip' ? [] : (draft.provinces || []);
    await setDraft(bot, userId, { provinces, step: 'awaiting_obs' });
    await bot.sendMessage(chatId, stepPrompt('awaiting_obs'), { reply_markup: kbBackCancel() });
    return;
  }
  if (action === 't') {
    const name = CUBA_PROVINCES[Number(parts[2])];
    if (!name) return;
    const cur = draft.provinces || [];
    const next = cur.includes(name) ? cur.filter(p => p !== name) : [...cur, name];
    await setDraft(bot, userId, { provinces: next });
    if (msg?.message_id) await bot.editMessageReplyMarkup(chatId, msg.message_id, kbProvinces(next, userId));
  }
}

export async function handleWizardCallback(bot, { id, data, msg, chatId, userId }) {
  await bot.answerCallbackQuery(id);

  const draft = await getDraft(bot, userId);
  if (!draft) return;

  const prevMap = {
    awaiting_model: 'awaiting_name',
    awaiting_works: 'awaiting_model',
    awaiting_bands: 'awaiting_works',
    awaiting_provinces: 'awaiting_bands',
    awaiting_obs: 'awaiting_provinces',
    confirm: 'awaiting_obs'
  };

  if (data === 'wiz:cancel') {
    await cancelWizard(bot, chatId, userId);
    return;
  }
  if (data === 'wiz:back') {
    const prev = prevMap[draft.step];
    if (!prev) return;
    await setDraft(bot, userId, { step: prev });
    // re-prompt according to prev step
    switch (prev) {
      case 'awaiting_name':
        await bot.sendMessage(chatId, stepPrompt('awaiting_name'), { reply_markup: kbCancel() });
        break;
      case 'awaiting_model':
        await bot.sendMessage(chatId, stepPrompt('awaiting_model'), { reply_markup: kbBackCancel() });
        break;
      case 'awaiting_works':
        await bot.sendMessage(chatId, stepPrompt('awaiting_works'), { reply_markup: kbWorks() });
        break;
      case 'awaiting_bands':
        await bot.sendMessage(chatId, stepPrompt('awaiting_bands'), { reply_markup: kbBackCancel() });
        break;
      case 'awaiting_provinces':
        await bot.sendMessage(chatId, progress('awaiting_provinces') + '📍 ¿En qué provincias lo probaste? Toca para marcar/desmarcar y pulsa "✔️ Listo".', { reply_markup: kbProvinces(draft.provinces || [], userId) });
        break;
      case 'awaiting_obs':
        await bot.sendMessage(chatId, stepPrompt('awaiting_obs'), { reply_markup: kbBackCancel() });
        break;
    }
    return;
  }
  if (data === 'wiz:works_yes') {
    if (draft.step === 'awaiting_works') {
      await setDraft(bot, userId, { works: true, step: 'awaiting_bands' });
      await bot.sendMessage(chatId, PROMPTS.awaiting_bands, { reply_markup: kbBackCancel() });
    }
    return;
  }
  if (data === 'wiz:works_no') {
    if (draft.step === 'awaiting_works') {
      await setDraft(bot, userId, { works: false, step: 'awaiting_obs' });
      await bot.sendMessage(chatId, progress('awaiting_obs') + 'Añade observaciones (ej: "sin señal 4G en Holguín").', { reply_markup: kbBackCancel() });
    }
    return;
  }
  if (data === 'wiz:confirm' && draft.step === 'confirm') {
    await submitPhone(bot, userId, chatId, msg?.message_id);
    return;
  }
}

export async function submitPhone(bot, userId, chatId, reactToMsgId) {
  const d = await getDraft(bot, userId);
  if (!d) return;

  const modelUpper = toUpperModel(d.model);
  const bands = Array.isArray(d.bands) ? d.bands : splitNormList(d.bands);
  const provinces = Array.isArray(d.provinces) ? d.provinces : splitNormList(d.provinces);

  const payload = {
    commercial_name: d.commercial_name,
    model: modelUpper,
    works: !!d.works,
    bands: bands || [],
    provinces: provinces || [],
    observations: d.observations || null,
  };

  // Validate submission server-side before inserting
  const validation = validate(phoneSubmissionSchema, payload);
  if (!validation.success) {
    logger.error('submitPhone invalid payload', null, { userId, chatId, errors: validation.error });
    await bot.sendMessage(chatId, 'Datos inválidos en la propuesta. Intenta de nuevo o /cancelar.');
    return;
  }

  const bandsStr = JSON.stringify(payload.bands);
  const provincesStr = JSON.stringify(payload.provinces);
  const worksInt = payload.works ? 1 : 0;
  const createdAt = new Date().toISOString();

  const nombreComercial = normalizeText(payload.commercial_name);

  let insertedId = null;
  try {
    const row = await bot.db.prepare(
      "INSERT INTO phones (commercial_name, model, works, bands, provinces, observations, nombre_comercial, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id"
    ).bind(payload.commercial_name, payload.model, worksInt, bandsStr, provincesStr, payload.observations, nombreComercial, createdAt).first();
    insertedId = row?.id;
  } catch (error) {
    if (/unique constraint|duplicate key/i.test(String(error))) {
      await clearDraft(bot, userId);
      await bot.sendMessage(chatId, '📱 Ese modelo ya está en la base de datos. Si crees que hay un error en sus datos, usa /reportar para avisarnos. ¡Gracias por aportar!');
      return;
    }
    logger.error('submitPhone error', error, { userId, chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    return;
  }

  await clearDraft(bot, userId);
  // Celebrar con una reacción sobre el mensaje que confirmó (si lo tenemos)
  if (reactToMsgId) await bot.setMessageReaction(chatId, reactToMsgId, '🎉');
  await bot.sendMessage(chatId,
    '✅ <b>¡Propuesta guardada!</b>\n' +
    'Pasará a revisión y, cuando un admin la apruebe, aparecerá en /revisar.\n\n' +
    '🔔 ¿Quieres enterarte de cada teléfono nuevo? Usa /suscribir.');
  if (insertedId) await notifyAdminsNewSubmission(bot, insertedId);
}

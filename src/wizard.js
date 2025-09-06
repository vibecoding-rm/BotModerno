/* src/wizard.js
 * Wizard helpers backed by Supabase tables.
 */
import { Markup } from 'telegraf';

const STEPS = [
  'awaiting_name',
  'awaiting_model',
  'awaiting_works',
  'awaiting_bands',
  'awaiting_obs',
  'confirm'
];

async function getDraft(db, tgId) {
  const { data } = await db.from('submission_drafts').select('*').eq('tg_id', tgId).maybeSingle();
  return data || null;
}
async function setDraft(db, tgId, patch) {
  const existing = await getDraft(db, tgId);
  if (existing) {
    const { data, error } = await db.from('submission_drafts').update({ ...existing, ...patch }).eq('tg_id', tgId).select('*').single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db.from('submission_drafts').insert({ tg_id: tgId, step: 'awaiting_name', ...patch }).select('*').single();
    if (error) throw error;
    return data;
  }
}
async function clearDraft(db, tgId) {
  await db.from('submission_drafts').delete().eq('tg_id', tgId);
}

export async function startWizard(ctx) {
  const tgId = String(ctx.from.id);
  await setDraft(ctx.db, tgId, { step: 'awaiting_name' });
  await ctx.reply('📲 Vamos a subir un modelo. Dime el nombre comercial (ej: "Redmi Note 12").');
}

export async function cancelWizard(ctx) {
  const tgId = String(ctx.from.id);
  await clearDraft(ctx.db, tgId);
  await ctx.reply('Listo, cancelado. Puedes empezar de nuevo con /subir.');
}

// Parses 'si/no' and variants
function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (['si','sí','s','yes','y'].includes(t)) return true;
  if (['no','n'].includes(t)) return false;
  return null;
}

function csvEscape(str){
  if (str == null) return '';
  const s = String(str);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function handleWizardText(ctx) {
  const tgId = String(ctx.from.id);
  const draft = await getDraft(ctx.db, tgId);
  if (!draft) return false;

  const text = (ctx.message?.text || '').trim();

  switch (draft.step) {
    case 'awaiting_name': {
      if (text.length < 2) return ctx.reply('Por favor, envía un nombre comercial válido.');
      await setDraft(ctx.db, tgId, { commercial_name: text, step: 'awaiting_model' });
      await ctx.reply('Modelo exacto (ej: "2209116AG").');
      return true;
    }
    case 'awaiting_model': {
      if (text.length < 1) return ctx.reply('Modelo inválido.');
      await setDraft(ctx.db, tgId, { model: text, step: 'awaiting_works' });
      await ctx.reply('¿Funciona en Cuba? Responde "sí" o "no".');
      return true;
    }
    case 'awaiting_works': {
      const yn = parseYesNo(text);
      if (yn == null) return ctx.reply('Responde "sí" o "no".');
      if (yn) {
        await setDraft(ctx.db, tgId, { works_in_cuba: true, step: 'awaiting_bands' });
        await ctx.reply('Indica las bandas separadas por coma (ej: B3,B7,B28) o escribe "desconocido".');
      } else {
        await setDraft(ctx.db, tgId, { works_in_cuba: false, step: 'awaiting_obs' });
        await ctx.reply('Añade observaciones (ej: "sin señal 4G en Holguín").');
      }
      return true;
    }
    case 'awaiting_bands': {
      const bands = text.toLowerCase() === 'desconocido' ? [] : text.split(',').map(b => b.trim()).filter(Boolean);
      await setDraft(ctx.db, tgId, { bands, step: 'awaiting_obs' });
      await ctx.reply('Observaciones adicionales (opcional). Escribe "-" para omitir.');
      return true;
    }
    case 'awaiting_obs': {
      const obs = text === '-' ? null : text;
      await setDraft(ctx.db, tgId, { observations: obs, step: 'confirm' });
      const d = await getDraft(ctx.db, tgId);
      const summary = [
        `📌 *Revisar envío*`,
        `Nombre: ${d.commercial_name}`,
        `Modelo: ${d.model}`,
        `¿Funciona?: ${d.works_in_cuba ? 'Sí' : 'No'}`,
        `Bandas: ${(d.bands && d.bands.length) ? d.bands.join('|') : '—'}`,
        `Obs: ${d.observations || '—'}`
      ].join('\n');
      await ctx.replyWithMarkdown(summary + '\n\nResponde "ok" para confirmar o "cancelar" para abortar.');
      return true;
    }
    case 'confirm': {
      const ok = text.trim().toLowerCase();
      if (!['ok','sí','si','yes'].includes(ok)) {
        if (['cancelar','cancel'].includes(ok)) return cancelWizard(ctx);
        return ctx.reply('Escribe "ok" para confirmar o "cancelar" para abortar.');
      }
      const d = await getDraft(ctx.db, tgId);
      // Insert into phones as pending (assumed schema)
      const { error } = await ctx.db.from('phones').insert({
        commercial_name: d.commercial_name,
        model: d.model,
        bands: d.bands || null,
        provinces: null,
        status: 'pending',
        works_in_cuba: d.works_in_cuba,
        observations: d.observations,
        submitted_by_tg: tgId
      });
      if (error) {
        console.error('Insert phone error', error);
        await ctx.reply('⚠️ No pude guardar el modelo. Intenta más tarde.');
      } else {
        await ctx.reply('✅ Enviado. Queda pendiente de moderación. ¡Gracias!');
        await clearDraft(ctx.db, tgId);
      }
      return true;
    }
    default:
      return false;
  }
}

// Reports & subscriptions
export async function handleReport(ctx) {
  if (ctx.chat?.type !== 'private') return ctx.reply('Haz /reportar por DM, por favor.');
  const text = (ctx.message?.text || '').trim();
  const parts = text.split(' ').slice(1);
  const id = parts.shift();
  const body = parts.join(' ').trim();
  if (!id || !body) return ctx.reply('Uso: /reportar <id> <texto>');
  const { error } = await ctx.db.from('reports').insert({
    phone_id: Number(id),
    reporter_tg_id: String(ctx.from.id),
    reporter_username: ctx.from.username || null,
    text: body,
  });
  if (error) {
    console.error('report error', error);
    return ctx.reply('No pude registrar el reporte.');
  }
  return ctx.reply('Gracias, reportado. Nuestro equipo lo revisará.');
}

export async function handleSubscribe(ctx) {
  const { error } = await ctx.db.from('subscriptions').upsert({
    tg_id: String(ctx.from.id),
    username: ctx.from.username || null,
  });
  if (error) return ctx.reply('No pude suscribirte.');
  return ctx.reply('📣 Te avisaremos por DM cuando se aprueben modelos nuevos.');
}
export async function handleUnsubscribe(ctx) {
  await ctx.db.from('subscriptions').delete().eq('tg_id', String(ctx.from.id));
  return ctx.reply('🔕 Suscripción cancelada.');
}

// Util to notify subscribers (called from panel API on approve)
export async function notifySubscribers(db, bot, phone) {
  const { data } = await db.from('subscriptions').select('tg_id');
  const msg = `✅ Aprobado: ${phone.commercial_name} (${phone.model})`;
  for (const row of data || []) {
    try { await bot.telegram.sendMessage(row.tg_id, msg); } catch (e) { /* ignore */ }
  }
}

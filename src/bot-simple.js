/* src/bot-simple.js
 * Simplified Telegram bot for Cloudflare Workers
 * Without Telegraf dependency - using direct Telegram API
 */

import { createClient } from '@supabase/supabase-js';

export class SimpleTelegramBot {
  constructor(env) {
    this.token = env.BOT_TOKEN;
    this.supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    this.adminIds = (env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    this.allowedChatIds = (env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  async sendMessage(chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'Markdown',
        ...options
      })
    });
    return await response.json();
  }

  async handleUpdate(update) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      }
    } catch (error) {
      console.error('Handle update error:', error);
    }
  }

  async handleMessage(message) {
    const chatId = message.chat.id;
    const chatType = message.chat.type;
    const text = message.text || '';
    const userId = message.from.id;

    // Control de acceso para grupos
    if ((chatType === 'group' || chatType === 'supergroup')) {
      if (this.allowedChatIds.length && !this.allowedChatIds.includes(String(chatId))) {
        return; // Silenciosamente ignorar
      }
    }

    // Comandos
    if (text.startsWith('/')) {
      await this.handleCommand(message, text, chatType, chatId, userId);
    } else {
      // Manejo de texto para wizard en DM
      if (chatType === 'private') {
        await this.handleWizardText(message, text, chatId, userId);
      }
    }
  }

  async handleCommand(message, text, chatType, chatId, userId) {
    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/start':
        await this.sendMessage(chatId, 
          `¡Bienvenido a CubaModel Bot! 📱🇨🇺\n\n` +
          `Bot colaborativo para verificar qué teléfonos funcionan en Cuba.\n\n` +
          `Comandos:\n` +
          `• /subir — Iniciar asistente (por DM)\n` +
          `• /revisar — Revisar modelos (solo en grupos)\n` +
          `• /reportar <id> <texto> — Reportar un error\n` +
          `• /suscribir — Recibir notificaciones por DM\n` +
          `• /cancelar — Cancelar asistente en curso`
        );
        break;

      case '/subir':
        if (chatType !== 'private') {
          await this.sendMessage(chatId, 
            'En el grupo usamos /revisar. Para subir, escríbeme por DM: @cubamodel_bot'
          );
        } else {
          await this.startWizard(chatId, userId);
        }
        break;

      case '/revisar':
        if (chatType === 'private') {
          await this.sendMessage(chatId, 
            'El comando /revisar solo funciona en grupos. Aquí en DM puedes usar /subir para agregar un teléfono.'
          );
        } else {
          await this.showRecentPhones(chatId);
        }
        break;

      case '/cancelar':
        await this.cancelWizard(chatId, userId);
        break;

      case '/suscribir':
        await this.handleSubscribe(chatId, userId, message.from.username);
        break;

      case '/reportar':
        if (chatType !== 'private') {
          await this.sendMessage(chatId, 'Haz /reportar por DM, por favor.');
        } else {
          await this.handleReport(text, chatId, userId, message.from.username);
        }
        break;

      default:
        if (chatType === 'private') {
          await this.sendMessage(chatId, 
            'Usa /subir para iniciar el asistente o /start para ver comandos.'
          );
        }
        break;
    }
  }

  async showRecentPhones(chatId) {
    try {
      const { data: phones } = await this.supabase
        .from('phones')
        .select('id, commercial_name, model, works_in_cuba, status')
        .eq('status', 'approved')
        .order('id', { ascending: false })
        .limit(5);
        
      if (!phones || phones.length === 0) {
        await this.sendMessage(chatId, '📱 Aún no hay teléfonos aprobados en la base de datos.');
        return;
      }
      
      let message = '📱 *Últimos teléfonos verificados:*\n\n';
      phones.forEach(phone => {
        const status = phone.works_in_cuba ? '✅ Funciona' : '❌ No funciona';
        message += `• ${phone.commercial_name} (${phone.model || 'N/A'}) - ${status}\n`;
      });
      message += '\n💻 Ver más detalles en el panel web o usa /subir por DM para agregar uno.';
      
      await this.sendMessage(chatId, message);
    } catch (error) {
      console.error('Error in showRecentPhones:', error);
      await this.sendMessage(chatId, '⚠️ Error al consultar la base de datos. Intenta de nuevo.');
    }
  }

  async startWizard(chatId, userId) {
    try {
      await this.setDraft(String(userId), { step: 'awaiting_name' });
      await this.sendMessage(chatId, '📲 Vamos a subir un modelo. Dime el nombre comercial (ej: "Redmi Note 12").');
    } catch (error) {
      console.error('Start wizard error:', error);
      await this.sendMessage(chatId, '⚠️ Error al iniciar el asistente.');
    }
  }

  async cancelWizard(chatId, userId) {
    try {
      await this.clearDraft(String(userId));
      await this.sendMessage(chatId, 'Listo, cancelado. Puedes empezar de nuevo con /subir.');
    } catch (error) {
      console.error('Cancel wizard error:', error);
      await this.sendMessage(chatId, '⚠️ Error al cancelar.');
    }
  }

  async handleSubscribe(chatId, userId, username) {
    try {
      const { error } = await this.supabase
        .from('subscriptions')
        .upsert({
          tg_id: String(userId),
          username: username || null,
        });
      
      if (error) {
        await this.sendMessage(chatId, 'No pude suscribirte.');
      } else {
        await this.sendMessage(chatId, '📣 Te avisaremos por DM cuando se aprueben modelos nuevos.');
      }
    } catch (error) {
      console.error('Subscribe error:', error);
      await this.sendMessage(chatId, '⚠️ Error en la suscripción.');
    }
  }

  async handleWizardText(message, text, chatId, userId) {
    try {
      const draft = await this.getDraft(String(userId));
      if (!draft) return false;

      switch (draft.step) {
        case 'awaiting_name':
          if (text.length < 2) {
            await this.sendMessage(chatId, 'Por favor, envía un nombre comercial válido.');
            return;
          }
          await this.setDraft(String(userId), { commercial_name: text, step: 'awaiting_model' });
          await this.sendMessage(chatId, 'Modelo exacto (ej: "2209116AG").');
          break;

        case 'awaiting_model':
          if (text.length < 1) {
            await this.sendMessage(chatId, 'Modelo inválido.');
            return;
          }
          await this.setDraft(String(userId), { model: text, step: 'awaiting_works' });
          await this.sendMessage(chatId, '¿Funciona en Cuba? Responde "sí" o "no".');
          break;

        case 'awaiting_works':
          const works = this.parseYesNo(text);
          if (works === null) {
            await this.sendMessage(chatId, 'Responde "sí" o "no".');
            return;
          }
          if (works) {
            await this.setDraft(String(userId), { works_in_cuba: true, step: 'awaiting_bands' });
            await this.sendMessage(chatId, 'Indica las bandas separadas por coma (ej: B3,B7,B28) o escribe "desconocido".');
          } else {
            await this.setDraft(String(userId), { works_in_cuba: false, step: 'awaiting_obs' });
            await this.sendMessage(chatId, 'Añade observaciones (ej: "sin señal 4G en Holguín").');
          }
          break;

        case 'awaiting_bands':
          const bands = text.toLowerCase() === 'desconocido' ? '' : text;
          await this.setDraft(String(userId), { bands, step: 'awaiting_provinces' });
          await this.sendMessage(chatId, 'Indica las provincias separadas por coma (ej: La Habana, Santiago de Cuba) o escribe "-" para omitir.');
          break;

        case 'awaiting_provinces':
          const provinces = text === '-' ? '' : text;
          await this.setDraft(String(userId), { provinces, step: 'awaiting_obs' });
          await this.sendMessage(chatId, 'Observaciones adicionales (opcional). Escribe "-" para omitir.');
          break;

        case 'awaiting_obs':
          const obs = text === '-' ? null : text;
          await this.setDraft(String(userId), { observations: obs, step: 'confirm' });
          
          const finalDraft = await this.getDraft(String(userId));
          const confirmation = this.formatConfirmation(finalDraft);
          
          await this.sendMessage(chatId, confirmation + '\n\n¿Confirmar? (sí/no)');
          break;

        case 'confirm':
          const confirm = this.parseYesNo(text);
          if (confirm === null) {
            await this.sendMessage(chatId, 'Responde "sí" para confirmar o "no" para cancelar.');
            return;
          }
          
          if (confirm) {
            await this.submitPhone(String(userId), chatId);
          } else {
            await this.cancelWizard(chatId, userId);
          }
          break;
      }
    } catch (error) {
      console.error('Wizard text error:', error);
      await this.sendMessage(chatId, '⚠️ Error en el asistente.');
    }
  }

  parseYesNo(text) {
    const t = text.trim().toLowerCase();
    if (['si','sí','s','yes','y'].includes(t)) return true;
    if (['no','n'].includes(t)) return false;
    return null;
  }

  formatConfirmation(draft) {
    return `📱 *Resumen:*\n\n` +
           `**Nombre:** ${draft.commercial_name}\n` +
           `**Modelo:** ${draft.model}\n` +
           `**Funciona en Cuba:** ${draft.works_in_cuba ? 'Sí' : 'No'}\n` +
           `**Bandas:** ${draft.bands || 'No especificado'}\n` +
           `**Provincias:** ${draft.provinces || 'No especificado'}\n` +
           `**Observaciones:** ${draft.observations || 'Ninguna'}`;
  }

  async submitPhone(userId, chatId) {
    try {
      const draft = await this.getDraft(userId);
      if (!draft) return;

      // Convert text to arrays for bands and provinces
      const bandsArray = draft.bands ? draft.bands.split(',').map(s => s.trim()).filter(Boolean) : [];
      const provincesArray = draft.provinces ? draft.provinces.split(',').map(s => s.trim()).filter(Boolean) : [];

      const { error } = await this.supabase
        .from('phones')
        .insert({
          commercial_name: draft.commercial_name,
          model: draft.model,
          works_in_cuba: draft.works_in_cuba,
          bands: bandsArray,
          provinces: provincesArray,
          observations: draft.observations,
          submitted_by_tg: userId,
          status: 'pending'
        });

      await this.clearDraft(userId);

      if (error) {
        console.error('Submit phone error:', error);
        await this.sendMessage(chatId, '⚠️ Error al guardar. Intenta de nuevo.');
      } else {
        await this.sendMessage(chatId, '✅ ¡Enviado! Un admin lo revisará pronto. Gracias por contribuir. 📱');
      }
    } catch (error) {
      console.error('Submit phone error:', error);
      await this.sendMessage(chatId, '⚠️ Error al enviar.');
    }
  }

  // Database helpers
  async getDraft(tgId) {
    const { data } = await this.supabase
      .from('submission_drafts')
      .select('*')
      .eq('tg_id', tgId)
      .maybeSingle();
    return data || null;
  }

  async setDraft(tgId, patch) {
    const existing = await this.getDraft(tgId);
    if (existing) {
      const { data, error } = await this.supabase
        .from('submission_drafts')
        .update({ ...existing, ...patch })
        .eq('tg_id', tgId)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await this.supabase
        .from('submission_drafts')
        .insert({ tg_id: tgId, step: 'awaiting_name', ...patch })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }
  }

  async clearDraft(tgId) {
    await this.supabase
      .from('submission_drafts')
      .delete()
      .eq('tg_id', tgId);
  }

  async handleReport(text, chatId, userId, username) {
    try {
      const parts = text.split(' ').slice(1);
      const id = parts.shift();
      const body = parts.join(' ').trim();
      
      if (!id || !body) {
        await this.sendMessage(chatId, 'Uso: /reportar <id> <texto>');
        return;
      }

      const { error } = await this.supabase
        .from('reports')
        .insert({
          phone_id: Number(id),
          reporter_tg_id: String(userId),
          reporter_username: username || null,
          text: body,
        });

      if (error) {
        console.error('Report error:', error);
        await this.sendMessage(chatId, 'No pude registrar el reporte.');
      } else {
        await this.sendMessage(chatId, 'Gracias, reportado. Nuestro equipo lo revisará.');
      }
    } catch (error) {
      console.error('Handle report error:', error);
      await this.sendMessage(chatId, '⚠️ Error al reportar.');
    }
  }
}
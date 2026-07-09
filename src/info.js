/* src/info.js
 * Textos informativos: bienvenida, reglas, estadísticas, guía de bandas y ayuda.
 */
import { logger } from './logger.js';
import { EFFECTS } from './telegram.js';
import { kbWelcome } from './keyboards.js';
import { startWizard } from './wizard.js';
import { sendExportOptions } from './export.js';

export async function sendWelcomeMessage(bot, chatId, userId, chatType) {
  try {
    const config = await bot.getBotConfig();
    let welcomeMessage = config.welcome;

    if (!welcomeMessage) {
      // Fallback to default welcome message
      welcomeMessage = `🎉 ¡BIENVENIDO A CUBAMODEL! 🇨🇺📱

🌟 Base de Datos Abierta para Teléfonos en Cuba

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.

✨ Aquí todo es distinto: la información será SIEMPRE abierta y descargable.

⚠️ LIMITACIONES ACTUALES:
• Puede ir lento en horas pico
• Hay topes de consultas
• Puede fallar (fase desarrollo)

💫 Gracias por sumarte.
Esto es de todos y para todos. ✨`;
    }

    // Replace {fullname} placeholder if user info is available
    if (welcomeMessage.includes('{fullname}')) {
      // For now, we'll use a generic greeting since we don't have user info in this context
      welcomeMessage = welcomeMessage.replace('{fullname}', 'usuario');
    }

    if (chatType === 'private') {
      // Con banner configurado (foto + caption); el caption de Telegram tope 1024 chars
      if (config.welcome_photo && welcomeMessage.length <= 1024) {
        const res = await bot.sendPhoto(chatId, config.welcome_photo, {
          caption: welcomeMessage,
          parse_mode: 'plain',
          reply_markup: kbWelcome(),
          message_effect_id: EFFECTS.party
        });
        if (res?.ok) return;
        // Si el file_id quedó inválido, cae al mensaje de texto
      }
      // Texto de bot_config (o fallback): sin parse_mode para no romper con caracteres sueltos
      await bot.sendMessage(chatId, welcomeMessage, { reply_markup: kbWelcome(), parse_mode: 'plain', message_effect_id: EFFECTS.party });
    } else {
      // En grupo: bienvenida corta en el propio grupo (sin DMs no solicitados)
      await bot.sendMessage(chatId, getShortRules());
    }
  } catch (error) {
    logger.error('Error fetching welcome message from database', error);
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo en un momento.');
  }
}

export async function welcomeUserDM(bot, user, chat) {
  try {
    const config = await bot.getBotConfig();
    let msg = config.welcome;

    if (!msg) {
      // Fallback to default welcome message
      const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
      msg = `👋 ¡Bienvenido ${fullname} a CubaModel! 🇨🇺📱\n\n` +
        'Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.\n' +
        'Aquí todo es distinto: la información será siempre abierta y descargable.\n\n' +
        '⚠️ Limitaciones:\n' +
        '• Puede ir lento en horas pico.\n' +
        '• Hay topes de consultas y almacenamiento.\n' +
        '• Puede caerse o fallar a veces (fase de desarrollo).\n\n' +
        '📜 Reglas:\n' +
        '1) Respeto; nada de insultos ni spam.\n' +
        '2) No ventas, solo compatibilidad de teléfonos en Cuba.\n' +
        '3) Aporta datos reales con /subir.\n' +
        '4) Usa /reportar para avisar de errores.\n' +
        '5) La base es de todos, nadie puede privatizarla.\n\n' +
        'Gracias por sumarte. Esto es de todos y para todos. ✨';
    } else {
      // Replace variables in welcome message
      const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
      const username = user.username ? `@${user.username}` : 'usuario';
      const chatTitle = chat.title || 'CubaModel';

      msg = msg
        .replace(/{fullname}/g, fullname)
        .replace(/{username}/g, username)
        .replace(/{chat_title}/g, chatTitle);
    }

    // Try DM; if user has blocked bot, ignore. Texto de bot_config → sin parse_mode.
    await bot.sendMessage(user.id, msg, { parse_mode: 'plain' });
  } catch (error) {
    logger.error('Error fetching welcome message from database', error);
    // Fallback to default welcome
    const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
    const defaultMsg = `👋 ¡Bienvenido ${fullname} a CubaModel! 🇨🇺📱\n\n` +
      'Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.\n' +
      'Aquí todo es distinto: la información será siempre abierta y descargable.\n\n' +
      'Gracias por sumarte. Esto es de todos y para todos. ✨';
    await bot.sendMessage(user.id, defaultMsg, { parse_mode: 'plain' });
  }
}

export async function sendRules(bot, userId, chatId, chatType) {
  const config = await bot.getBotConfig();
  const rules = config.rules ||
    '📜 Reglas:\n' +
    '1) Respeto; nada de insultos ni spam.\n' +
    '2) No ventas, solo compatibilidad de teléfonos en Cuba.\n' +
    '3) Aporta datos reales con /subir.\n' +
    '4) Usa /reportar para avisar de errores.\n' +
    '5) La base es de todos, nadie puede privatizarla.';

  // Reglas directamente en el chat donde se pidieron; texto de bot_config → sin parse_mode
  await bot.sendMessage(chatType === 'private' ? userId : chatId, rules, { parse_mode: 'plain' });
}

// Reglas resumidas para fijar en grupos
export function getShortRules() {
  return `📱 <b>CubaModel - Reglas Rápidas</b>

1️⃣ Respeto - Sin spam ni insultos
2️⃣ Solo compatibilidad de teléfonos
3️⃣ Usa /subir para agregar datos
4️⃣ /reportar para errores
5️⃣ Base de datos abierta para todos

💬 DM para reglas completas y verificación`;
}

export async function sendStats(bot, chatId) {
  try {
    const phonesRow = await bot.db.prepare("SELECT COUNT(*) AS n FROM phones WHERE status = 'approved'").first();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const eventsRow = await bot.db.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1").bind(cutoff).first();

    const totalPhones = phonesRow?.n || 0;
    const eventsToday = eventsRow?.n || 0;

    const statsMessage = `📊 <b>Estadísticas de CubaModel</b>

📱 <b>Teléfonos en la base:</b>
• Total aprobados: ${totalPhones}
• Última actualización: ${new Date().toLocaleDateString()}

📈 <b>Actividad:</b>
• Eventos hoy: ${eventsToday}
• Estado: ✅ Activo

🌐 <b>Información:</b>
• Base de datos: Abierta y gratuita
• Proyecto: Comunitario
• Región: Cuba 🇨🇺

💡 Usa /subir para agregar más teléfonos`;

    await bot.sendMessage(chatId, statsMessage);
  } catch (error) {
    logger.error('Error sending stats', error);
    await bot.sendMessage(chatId, '❌ Error obteniendo estadísticas. Intenta más tarde.');
  }
}

export async function sendBandsGuide(bot, chatId) {
  const guide = `📡 <b>Guía de bandas en Cuba (ETECSA)</b>

📶 <b>Redes disponibles:</b>
• 2G (GSM): 900 MHz — llamadas y SMS, casi cualquier teléfono.
• 3G (UMTS): 900/2100 MHz.
• 4G (LTE): <b>Banda 3 (B3, 1800 MHz)</b> — la principal en todo el país. En algunas zonas también hay Banda 7 (B7, 2600 MHz).

✅ <b>Lo clave:</b> para tener 4G en Cuba, tu teléfono debe soportar <b>LTE B3 (1800)</b>.

<blockquote expandable>🔍 <b>¿Cómo saber las bandas de tu teléfono?</b>
1. Mira el modelo exacto en Ajustes → Acerca del teléfono.
2. Búscalo en gsmarena.com o kimovil.com → sección "Red/Network".
3. Verifica que aparezca LTE B3 (1800). Si además trae B7, mejor.

⚠️ <b>Cuidado con teléfonos de operadoras de EE.UU.</b> (Cricket, Boost, Metro...): muchos vienen bloqueados de fábrica o sin B3 → revisa antes de comprar.</blockquote>
💡 Usa /revisar &lt;modelo&gt; para ver la experiencia real de la comunidad con ese modelo, y /subir para aportar la tuya.`;
  await bot.sendMessage(chatId, guide);
}

export async function sendHelp(bot, chatId) {
  const helpMessage = `❓ <b>Ayuda - CubaModel Bot</b>

🤖 <b>Comandos principales:</b>
• /start - Mensaje de bienvenida
• /subir - Agregar teléfono
• /revisar &lt;modelo&gt; - Buscar teléfonos
• /bandas - Guía de bandas 4G en Cuba
• /reglas - Ver reglas completas
• /exportar - Exportar base de datos
• /suscribir - Recibir avisos de novedades
• /id - Ver información de IDs
• /reportar - Reportar problema

<blockquote expandable>📱 <b>Cómo usar:</b>
1. <b>Agregar teléfono:</b> Usa /subir en el grupo y sigue los pasos
2. <b>Buscar teléfonos:</b> Usa /revisar Samsung A14
3. <b>Ver reglas:</b> Usa /reglas
4. <b>Exportar datos:</b> Usa /exportar y elige el formato

🔧 <b>Para administradores:</b>
• /pendientes - Revisar propuestas pendientes (aprobar/rechazar)
• /fijar - Mostrar reglas cortas en grupo
• /banner - Configurar la foto de bienvenida (en DM)</blockquote>
❓ <b>¿Necesitas más ayuda?</b>
Contacta a los administradores del grupo.`;

  await bot.sendMessage(chatId, helpMessage);
}

// Botones welcome:* del menú de bienvenida
export async function handleWelcomeCallback(bot, { chatId, userId, action }) {
  switch (action) {
    case 'add_phone':
      await startWizard(bot, chatId, userId);
      break;
    case 'search':
      await bot.sendMessage(chatId, '🔍 Para buscar teléfonos, usa el comando /revisar en el grupo o escribe el modelo que buscas.');
      break;
    case 'rules':
      await sendRules(bot, userId, chatId, 'private');
      break;
    case 'stats':
      await sendStats(bot, chatId);
      break;
    case 'export':
      await sendExportOptions(bot, chatId);
      break;
    case 'help':
      await sendHelp(bot, chatId);
      break;
    case 'back':
      await sendWelcomeMessage(bot, chatId, userId, 'private');
      break;
  }
}

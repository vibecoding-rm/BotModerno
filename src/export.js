/* src/export.js
 * /exportar: descarga de la base en CSV/JSON como documento de Telegram.
 */
import { logger } from './logger.js';
import { escapeHtml, parsePhoneRow, parseJsonArray } from './format.js';
import { kbExport } from './keyboards.js';

export async function sendExportOptions(bot, chatId) {
  const exportMessage = `📥 <b>Exportar Base de Datos</b>

Selecciona el formato que prefieras para descargar la información:

📄 <b>CSV</b> - Para Excel/Google Sheets
📋 <b>JSON</b> - Para desarrolladores
📊 <b>Estadísticas</b> - Solo números y resúmenes
📱 <b>Teléfonos</b> - Solo la lista de teléfonos

💡 <i>Los archivos se enviarán como documentos</i>`;

  await bot.sendMessage(chatId, exportMessage, { reply_markup: kbExport() });
}

export async function handleExportCallback(bot, chatId, userId, format) {
  try {
    // Exportar vuelca toda la base: limitar a 2 por minuto por usuario
    if (await bot.rateLimited(`export:${userId}`, 2)) {
      await bot.sendMessage(chatId, '⏳ Máximo 2 exportaciones por minuto. Espera un momento e intenta de nuevo.');
      return;
    }
    await bot.sendMessage(chatId, '⏳ Generando archivo de exportación...');

    let filename, content;

    switch (format) {
      case 'csv': {
        content = await exportToCSV(bot);
        filename = `cubamodel_phones_${new Date().toISOString().split('T')[0]}.csv`;
        break;
      }
      case 'json': {
        content = JSON.stringify(await exportToJSON(bot), null, 2);
        filename = `cubamodel_phones_${new Date().toISOString().split('T')[0]}.json`;
        break;
      }
      case 'stats': {
        content = JSON.stringify(await exportStats(bot), null, 2);
        filename = `cubamodel_stats_${new Date().toISOString().split('T')[0]}.json`;
        break;
      }
      case 'phones': {
        content = JSON.stringify(await exportPhonesOnly(bot), null, 2);
        filename = `cubamodel_phones_only_${new Date().toISOString().split('T')[0]}.json`;
        break;
      }
      default:
        await bot.sendMessage(chatId, '❌ Formato de exportación no válido.');
        return;
    }

    // Enviar como documento
    await sendDocument(bot, chatId, content, filename);
  } catch (error) {
    logger.error('Error exporting data:', error);
    await bot.sendMessage(chatId, '❌ Error generando el archivo de exportación. Intenta más tarde.');
  }
}

export async function exportToCSV(bot) {
  const res = await bot.db.prepare("SELECT * FROM phones WHERE status = 'approved' ORDER BY created_at DESC").all();
  const phones = res.results || [];

  const headers = ['ID', 'Nombre', 'Modelo', 'Funciona', 'Bandas', 'Provincias', 'Observaciones', 'Fecha Creación', 'Estado'];
  const csvRows = [headers.join(',')];

  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const joinJson = (v) => {
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch {
        return v;
      }
    }
    return Array.isArray(v) ? v.join(', ') : (v || '');
  };

  phones.forEach(phone => {
    const row = [
      phone.id,
      csvCell(phone.commercial_name),
      csvCell(phone.model),
      phone.works ? 'Sí' : 'No',
      csvCell(joinJson(phone.bands)),
      csvCell(joinJson(phone.provinces)),
      csvCell(phone.observations),
      phone.created_at,
      phone.status
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

export async function exportToJSON(bot) {
  const res = await bot.db.prepare("SELECT * FROM phones WHERE status = 'approved' ORDER BY created_at DESC").all();
  const phones = (res.results || []).map(parsePhoneRow);

  return {
    export_date: new Date().toISOString(),
    total_phones: phones.length,
    phones
  };
}

export async function exportStats(bot) {
  const counts = await bot.db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN works=1 THEN 1 ELSE 0 END) AS works_yes FROM phones"
  ).first();

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const eventsRow = await bot.db.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1").bind(cutoff).first();
  const lastRow = await bot.db.prepare("SELECT MAX(created_at) AS last FROM phones WHERE status='approved'").first();

  return {
    export_date: new Date().toISOString(),
    statistics: {
      total_phones: counts?.total || 0,
      approved_phones: counts?.approved || 0,
      pending_phones: counts?.pending || 0,
      works_in_cuba: counts?.works_yes || 0,
      events_last_30_days: eventsRow?.n || 0
    },
    summary: {
      last_updated: lastRow?.last || 'N/A'
    }
  };
}

export async function exportPhonesOnly(bot) {
  const res = await bot.db.prepare(
    "SELECT commercial_name, model, works, bands, provinces FROM phones WHERE status = 'approved' ORDER BY commercial_name ASC"
  ).all();
  const phones = res.results || [];

  return {
    export_date: new Date().toISOString(),
    phones: phones.map(phone => ({
      commercial_name: phone.commercial_name,
      model: phone.model,
      works: phone.works === 1 || phone.works === true,
      bands: parseJsonArray(phone.bands),
      provinces: parseJsonArray(phone.provinces)
    }))
  };
}

export async function sendDocument(bot, chatId, content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('document', blob, filename);
  formData.append('chat_id', chatId);
  formData.append('caption', `📥 ${filename}\n\nExportado el ${new Date().toLocaleString()}`);

  try {
    const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.description);
    }
  } catch (error) {
    logger.error('Error sending document:', error);
    // Fallback: enviar como mensaje de texto si falla el documento
    await bot.sendMessage(chatId, `📄 <b>${escapeHtml(filename)}</b>\n\n<pre>${escapeHtml(content.substring(0, 3500))}</pre>`);
  }
}

/* api/status.js
 * Health/status endpoint used by the panel dashboard.
 * Does NOT expose secrets.
 */
export default async function handler(req, res) {
  const hasBotToken = !!process.env.BOT_TOKEN;
  // If you want to actually check Telegram webhook, uncomment and handle rate limits.
  // let webhookSet = false;
  // try {
  //   if (hasBotToken) {
  //     const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getWebhookInfo`);
  //     const j = await r.json();
  //     webhookSet = !!j?.result?.url;
  //   }
  // } catch (_) {}
  const webhookSet = hasBotToken; // simplified to avoid external calls
  res.status(200).json({ hasBotToken, webhookSet });
}

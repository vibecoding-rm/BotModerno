/* src/lib/events.js
 * Event logging utilities for Cloudflare Workers
 * Handles structured logging to external services or KV storage
 */

import { logger } from '../logger.js';

/**
 * Log events to external service or KV storage
 * @param {Object} env - Environment variables
 * @param {string} eventType - Type of event (error, duplicate, etc.)
 * @param {Object} data - Event data
 */
export async function logEvent(env, eventType, data = {}) {
  try {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      ...data
    };

    // Log to console for now (can be extended to external services)
    logger.info(`Event: ${eventType}`, event);

    // If KV is available, store events there
    if (env.EVENTS_KV) {
      const key = `event:${Date.now()}:${eventType}`;
      await env.EVENTS_KV.put(key, JSON.stringify(event), {
        expirationTtl: 86400 * 7 // 7 days
      });
    }

    return event;
  } catch (error) {
    logger.error('Failed to log event', error, { eventType, data });
    return null;
  }
}

/**
 * Log webhook events for debugging
 * @param {Object} env - Environment variables
 * @param {Object} update - Telegram update
 * @param {string} status - Processing status
 */
export async function logWebhookEvent(env, update, status = 'processed') {
  return logEvent(env, 'webhook', {
    update_id: update?.update_id,
    status,
    chat_type: update?.message?.chat?.type || update?.callback_query?.message?.chat?.type,
    user_id: update?.message?.from?.id || update?.callback_query?.from?.id
  });
}

/**
 * Log bot command usage
 * @param {Object} env - Environment variables
 * @param {string} command - Command used
 * @param {number} userId - User ID
 * @param {string} chatType - Chat type
 */
export async function logCommandUsage(env, command, userId, chatType) {
  return logEvent(env, 'command', {
    command,
    user_id: userId,
    chat_type: chatType
  });
}
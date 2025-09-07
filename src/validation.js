import { z } from 'zod';

// Telegram Update schema (simplified)
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
    }).optional(),
    chat: z.object({
      id: z.number(),
      type: z.enum(['private', 'group', 'supergroup']),
    }),
    text: z.string().optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({
      id: z.number(),
    }),
    message: z.object({
      chat: z.object({
        id: z.number(),
      }),
    }).optional(),
    data: z.string().optional(),
  }).optional(),
});

// Phone submission schema
export const phoneSubmissionSchema = z.object({
  commercial_name: z.string().min(2),
  model: z.string().min(1),
  works: z.boolean(),
  bands: z.array(z.string()).optional(),
  provinces: z.array(z.string()).optional(),
  observations: z.string().optional(),
});

// Report schema
export const reportSchema = z.object({
  chat_id: z.string(),
  user_id: z.string(),
  reason: z.string().min(1),
});

// Validate function
export function validate(schema, data) {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    return { success: false, error: error.errors };
  }
}
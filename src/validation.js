import { z } from 'zod';

// Telegram Update schema (comprehensive)
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }).optional(),
    chat: z.object({
      id: z.number(),
      type: z.enum(['private', 'group', 'supergroup']),
      title: z.string().optional(),
    }),
    text: z.string().optional(),
    new_chat_members: z.array(z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      is_bot: z.boolean().optional(),
    })).optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }),
    message: z.object({
      chat: z.object({
        id: z.number(),
        type: z.enum(['private', 'group', 'supergroup']),
      }),
      message_id: z.number(),
    }).optional(),
    data: z.string().optional(),
  }).optional(),
  chat_join_request: z.object({
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }),
    chat: z.object({
      id: z.number(),
      type: z.enum(['group', 'supergroup']),
      title: z.string().optional(),
    }),
  }).optional(),
});

// Phone submission schema (enhanced)
export const phoneSubmissionSchema = z.object({
  commercial_name: z.string().min(2).max(100),
  model: z.string().min(1).max(50),
  works: z.boolean(),
  bands: z.array(z.string().max(20)).optional().default([]),
  provinces: z.array(z.string().max(50)).optional().default([]),
  observations: z.string().max(500).optional().nullable(),
});

// Report schema (enhanced)
export const reportSchema = z.object({
  tg_id: z.string().min(1),
  chat_id: z.string().min(1),
  model: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
});

// Subscription schema
export const subscriptionSchema = z.object({
  tg_id: z.string().min(1),
});

// Bot configuration schema
export const botConfigSchema = z.object({
  welcome: z.string().max(2000).optional(),
  rules: z.string().max(2000).optional(),
  show_short_welcome_in_group: z.boolean().optional().default(true),
});

// Environment variables validation
export const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TG_WEBHOOK_SECRET: z.string().min(10),
  ADMIN_TG_IDS: z.string().optional(),
  ALLOWED_CHAT_IDS: z.string().optional(),
});

// Validate function with better error handling
export function validate(schema, data) {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        success: false, 
        error: error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      };
    }
    return { 
      success: false, 
      error: [{ message: 'Validation failed', code: 'unknown' }]
    };
  }
}

// Helper function to validate environment variables
export function validateEnv(env) {
  return validate(envSchema, env);
}
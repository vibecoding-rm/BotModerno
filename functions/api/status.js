/* functions/api/status.js
 * Cloudflare Functions - Status endpoint
 */
import { createClient } from '@supabase/supabase-js';

export default {
  async fetch(request, env) {
    try {
      const supabase = createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      );
      
      // Test database connection
      const { data, error } = await supabase
        .from('phones')
        .select('count')
        .limit(1);
        
      if (error) throw error;
      
      const status = {
        ok: true,
        timestamp: new Date().toISOString(),
        database: 'connected',
        bot: 'active'
      };
      
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Status check failed:', error);
      
      const status = {
        ok: false,
        timestamp: new Date().toISOString(),
        database: 'error',
        bot: 'unknown',
        error: error.message
      };
      
      return new Response(JSON.stringify(status), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
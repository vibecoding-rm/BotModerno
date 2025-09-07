// Minimal ambient declarations to satisfy TypeScript in Cloudflare Pages Functions
// This avoids red squiggles for the PagesFunction type in editors/build tools.

declare type PagesFunction = (context: {
  request: Request;
  env: Record<string, any>;
  params: Record<string, string>;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  waitUntil: (promise: Promise<any>) => void;
}) => Response | Promise<Response>;

// Optional Env interface for hints
declare interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  [key: string]: any;
}

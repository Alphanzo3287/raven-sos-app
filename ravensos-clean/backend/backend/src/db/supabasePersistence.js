import { config } from '../config.js';

// Durable persistence by snapshotting the whole in-memory store into a single
// Supabase row (raven_state). The client is lazy-loaded so the app runs with no
// Supabase dependency when it isn't configured.

let client = null;
async function getClient() {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Load the saved snapshot, or null if none exists yet. */
export async function loadState() {
  const c = await getClient();
  const { data, error } = await c.from('raven_state').select('data').eq('id', 1).maybeSingle();
  if (error) {
    console.warn('Supabase load failed:', error.message);
    return null;
  }
  return data?.data ?? null;
}

/** Upsert the current snapshot. */
export async function saveState(dump) {
  const c = await getClient();
  const { error } = await c
    .from('raven_state')
    .upsert({ id: 1, data: dump, updated_at: new Date().toISOString() });
  if (error) console.warn('Supabase save failed:', error.message);
}

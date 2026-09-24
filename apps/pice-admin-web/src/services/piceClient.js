// src/services/piceClient.js
import { createClient } from '@supabase/supabase-js';

const PICE_SUPABASE_URL = import.meta.env.VITE_PICE_SUPABASE_URL;
const PICE_SUPABASE_ANON_KEY = import.meta.env.VITE_PICE_SUPABASE_ANON_KEY;

if (!PICE_SUPABASE_URL || !PICE_SUPABASE_ANON_KEY) {
  console.error("❌ CRITICAL: VITE_PICE_SUPABASE_URL or VITE_PICE_SUPABASE_ANON_KEY is missing from your .env file!");
}

export const piceClient = createClient(PICE_SUPABASE_URL, PICE_SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'pice-admin-auth-token',
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: (...args) => {
      console.log('⚡ [piceClient Request Target]:', args[0]);
      return fetch(...args);
    }
  }
});

// 👇 Ensure this export is explicitly present
export const PICE_ORG_ID = '00000000-0000-0000-0000-000000000003';
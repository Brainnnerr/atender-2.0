// src/services/supabase.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ CRITICAL: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing from your .env file!");
}

// 🚀 Use a named export so { supabase } imports work seamlessly everywhere
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'main-fco-auth-token',
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Main FCO Organization ID reference
export const IIEE_ORG_ID = '00000000-0000-0000-0000-000000000002'; // Or your active FCO/IIEE UUID
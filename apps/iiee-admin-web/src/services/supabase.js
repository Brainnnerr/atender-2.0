import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hoankpxctpvauvnixjpv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvYW5rcHhjdHB2YXV2bml4anB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4OTI5MTAsImV4cCI6MjEwNTQ2ODkxMH0.D7ByoSip5dQT8_Nf4XZs_9QI4RgO1MbSRIJKDAoiT0M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'iiee-admin-auth-token', // Changed to keep IIEE sessions isolated from PICE
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Matches the IIEE UUID from your SQL insert script
export const IIEE_ORG_ID = '00000000-0000-0000-0000-000000000002';
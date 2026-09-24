import { createClient } from '@supabase/supabase-js';

const ATTENDANCE_SUPABASE_URL = process.env.EXPO_PUBLIC_ATTENDANCE_SUPABASE_URL;
const ATTENDANCE_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_ATTENDANCE_SUPABASE_ANON_KEY;

export const attendanceClient = createClient(
  ATTENDANCE_SUPABASE_URL,
  ATTENDANCE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
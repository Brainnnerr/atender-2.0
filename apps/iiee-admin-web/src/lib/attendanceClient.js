// src/lib/attendanceClient.js
import { createClient } from '@supabase/supabase-js';

const ATTENDANCE_SUPABASE_URL = import.meta.env.VITE_ATTENDANCE_SUPABASE_URL;
const ATTENDANCE_SUPABASE_ANON_KEY = import.meta.env.VITE_ATTENDANCE_SUPABASE_ANON_KEY;

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
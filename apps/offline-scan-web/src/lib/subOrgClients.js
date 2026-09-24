import { createClient } from '@supabase/supabase-js';
import { supabase as mainSupabase } from './supabase';

export const SUB_ORGANIZATIONS = [
  {
    id: 'fco-main-federation',
    code: 'FCO',
    name: 'Federation of Council Organizations (FCO)',
    client: mainSupabase,
    eventsTable: 'events',
    attendanceTable: 'attendance',
    requiresOrgIdFilter: false
  },
  {
    id: '00000000-0000-0000-0000-000000000003', 
    code: 'PICE',
    name: 'Philippine Institute of Civil Engineers (PICE)',
    client: createClient(
      import.meta.env.VITE_PICE_SUPABASE_URL,
      import.meta.env.VITE_PICE_SUPABASE_ANON_KEY,
      { auth: { storageKey: 'sb-pice-auth-token' } }
    ),
    eventsTable: 'pice_events',
    attendanceTable: 'pice_attendance',
    requiresOrgIdFilter: true
  },
  {
    id: '00000000-0000-0000-0000-000000000002', 
    code: 'IIEE',
    name: 'Institute of Integrated Electrical Engineers (IIEE)',
    client: createClient(
      import.meta.env.VITE_ATTENDANCE_SUPABASE_URL,
      import.meta.env.VITE_ATTENDANCE_SUPABASE_ANON_KEY,
      { auth: { storageKey: 'sb-iiee-auth-token' } }
    ),
    eventsTable: 'iiee_events',
    attendanceTable: 'iiee_attendance',
    requiresOrgIdFilter: true
  }
];

// Provide both function names to prevent any export mismatch errors
export function getOrgConfig(orgId) {
  const org = SUB_ORGANIZATIONS.find(o => o.id === orgId);
  return org ? org : SUB_ORGANIZATIONS[0];
}

export function getSubOrgClient(orgId) {
  const org = SUB_ORGANIZATIONS.find(o => o.id === orgId);
  return org ? org.client : SUB_ORGANIZATIONS[0].client;
}
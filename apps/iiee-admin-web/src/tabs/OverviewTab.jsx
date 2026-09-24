import React, { useState, useEffect } from 'react';
import { Calendar, Users, Receipt, TrendingUp, CheckCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase'; // Main FCO database for profiles only
import { attendanceClient } from '../lib/attendanceClient'; // Secondary database for IIEE tables

export default function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [studentCount, setStudentCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [totalFinesValue, setTotalFinesValue] = useState(0);

  useEffect(() => {
    fetchOverviewData();
  }, []);

  const fetchOverviewData = async () => {
    try {
      setLoading(true);

      const [studentsRes, eventsRes, attendanceRes, finesRes] = await Promise.all([
        // 1. Profiles live in Main FCO Database
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .or('course.ilike.%BSEE%,course.ilike.%ELECTRICAL%'),

        // 2. IIEE Events live in Secondary Database
        attendanceClient
          .from('iiee_events')
          .select('id'),

        // 3. IIEE Attendance lives in Secondary Database
        attendanceClient
          .from('iiee_attendance')
          .select('*', { count: 'exact', head: true }),

        // 4. IIEE Fines live in Secondary Database
        attendanceClient
          .from('iiee_fines')
          .select('amount, status')
      ]);

      setStudentCount(studentsRes.count || 0);
      setEventCount(eventsRes.data?.length || 0);
      setAttendanceCount(attendanceRes.count || 0);

      if (finesRes.data) {
        const sum = finesRes.data.reduce((acc, f) => {
          if (['unpaid', 'pending_approval'].includes(String(f.status || '').toLowerCase())) {
            return acc + (parseFloat(f.amount) || 0);
          }
          return acc;
        }, 0);
        setTotalFinesValue(sum);
      }

    } catch (err) {
      console.error('Error loading IIEE overview analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '900', textTransform: 'uppercase', margin: 0 }}>Overview & Analytics</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Real-time telemetry and chapter activity metrics for IIEE.</p>
        </div>
        <div style={{ background: '#fff', padding: '8px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '800', color: '#854d0e' }}>
          LEDGER ACTIVE: IIEE SUB-ORG
        </div>
      </div>
      
      {/* Top Metric Analytics Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <MetricCard title="Total IIEE Students" value={loading ? '...' : studentCount} icon={<Users size={20} color="#854d0e" />} trend="BSEE / Electrical Enrolled" />
        <MetricCard title="Active IIEE Events" value={loading ? '...' : eventCount} icon={<Calendar size={20} color="#0284c7" />} trend="Isolated to IIEE" />
        <MetricCard title="Attendance Logs" value={loading ? '...' : attendanceCount} icon={<CheckCircle2 size={20} color="#16a34a" />} trend="Scanned via QR" />
        <MetricCard title="Total Fines Recorded" value={loading ? '...' : `₱${totalFinesValue.toFixed(2)}`} icon={<Receipt size={20} color="#dc2626" />} trend="Outstanding ledger" />
      </div>

      {/* Analytics Breakdown Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '900', textTransform: 'uppercase', marginBottom: '16px', color: '#0f172a' }}>
            System Information
          </h2>
          <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: '12px', color: '#334155', lineHeight: '1.5', margin: '0 0 8px 0' }}>
              This IIEE console operates as a dedicated module within the Atender platform. While it runs inside the same application framework, all event records, QR scanning validation rules, and fines are entirely separated from the central FCO ledger and restricted strictly to Electrical Engineering students.
            </p>
            <p style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5', margin: 0 }}>
              If you encounter any technical issues, data inconsistencies, or have questions regarding this system, please reach out directly to the system creator for assistance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, trend }) {
  return (
    <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
          <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '10px' }}>{icon}</div>
        </div>
        <div style={{ fontSize: '32px', fontWeight: '900', color: '#0f172a' }}>{value}</div>
      </div>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <TrendingUp size={14} color="#16a34a" /> {trend}
      </div>
    </div>
  );
}
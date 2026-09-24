import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabase } from './lib/supabase'; // Main FCO database client
import { SUB_ORGANIZATIONS, getOrgConfig, getSubOrgClient } from './lib/subOrgClients';
import Login from './components/Login';
import { 
  CheckCircle2, 
  AlertTriangle, 
  QrCode, 
  UserCheck, 
  Wifi, 
  Building, 
  Calendar, 
  ShieldCheck,
  Lock,
  Unlock,
  LogOut
} from 'lucide-react';

export default function App() {
  // --- AUTH STATES WITH LOCALSTORAGE PERSISTENCE ---
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('atender_admin_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [adminRole, setAdminRole] = useState(() => {
    const saved = localStorage.getItem('atender_admin_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.user?.role || 'fco';
    }
    return null;
  });

  // --- SCANNER STATES ---
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const scannerRef = useRef(null);

  // Itakda ang tamang Organization ID kapag nag-login o nag-load ang session
  useEffect(() => {
    if (session && session.user?.role) {
      const role = session.user.role;
      setAdminRole(role);
      
      let matchedOrg = SUB_ORGANIZATIONS[0];
      if (role === 'iiee') {
        matchedOrg = SUB_ORGANIZATIONS.find(org => org.id.includes('iiee') || org.code === 'IIEE') || SUB_ORGANIZATIONS[0];
      } else if (role === 'pice') {
        matchedOrg = SUB_ORGANIZATIONS.find(org => org.id.includes('pice') || org.code === 'PICE') || SUB_ORGANIZATIONS[0];
      } else {
        matchedOrg = SUB_ORGANIZATIONS.find(org => org.id.includes('fco') || org.id.includes('main')) || SUB_ORGANIZATIONS[0];
      }
      setSelectedOrgId(matchedOrg.id);
    }
  }, [session]);

  const handleLoginSuccess = (sessionData) => {
    setSession(sessionData);
  };

  const handleLogout = () => {
    localStorage.removeItem('atender_admin_session');
    setSession(null);
    setAdminRole(null);
    setSelectedOrgId('');
  };

  useEffect(() => {
    if (selectedOrgId && session) {
      fetchEvents(selectedOrgId);
    }

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [selectedOrgId, session]);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3500);
  };

  // 🚀 FIXED & ROBUST EVENT FETCHING PARA SA IIEE, PICE, AT FCO
  const fetchEvents = async (orgId) => {
    try {
      setScanning(false);
      const activeOrg = getOrgConfig(orgId);
      if (!activeOrg) {
        throw new Error(`Organization configuration not found for ID: ${orgId}`);
      }
      
      let query = activeOrg.client
        .from(activeOrg.eventsTable)
        .select('*');

      if (activeOrg.requiresOrgIdFilter) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query.order('start_time', { ascending: false });

      if (error) throw error;

      const nowTime = new Date().getTime();
      const processedEvents = (data || []).map(evt => {
        const start = evt.start_time ? new Date(evt.start_time).getTime() : 0;
        const end = evt.end_time ? new Date(evt.end_time).getTime() : 0;
        const isOpen = nowTime >= start && nowTime <= end;

        return {
          ...evt,
          isOpen
        };
      });

      setEvents(processedEvents);
      if (processedEvents.length > 0) {
        setSelectedEventId(processedEvents[0].id);
      } else {
        setSelectedEventId('');
      }
    } catch (err) {
      console.error('Error fetching events for org:', orgId, err);
      showToast(`Failed to load events for ${orgId}: ${err.message}`, 'error');
      setEvents([]);
      setSelectedEventId('');
    }
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);
  
  const getEventAccessStatus = (event) => {
    if (!event) return { isOpen: false, label: 'CLOSED' };
    const now = currentTime.getTime();
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();

    if (now >= start && now <= end) {
      return { isOpen: true, label: 'OPEN (ACTIVE)' };
    } else if (now < start) {
      return { isOpen: false, label: 'UPCOMING' };
    } else {
      return { isOpen: false, label: 'CLOSED (EXPIRED)' };
    }
  };

  const currentAccess = getEventAccessStatus(selectedEvent);
  const isEventClosed = !currentAccess.isOpen;

  // Camera Scanner Lifecycle
  useEffect(() => {
    if (scanning && selectedEventId && !isEventClosed) {
      const timer = setTimeout(() => {
        if (!scannerRef.current) {
          const scanner = new Html5QrcodeScanner(
            "reader",
            { fps: 10, qrbox: { width: 250, height: 250 } },
            false
          );
          scanner.render(onScanSuccess, onScanError);
          scannerRef.current = scanner;
        }
      }, 100);

      return () => clearTimeout(timer);
    } else {
      if (scannerRef.current) {
        scannerRef.current.clear().catch((err) => console.error("Scanner cleanup error", err));
        scannerRef.current = null;
      }
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch((err) => console.error("Scanner cleanup error", err));
        scannerRef.current = null;
      }
    };
  }, [scanning, selectedEventId, isEventClosed]);

  const onScanSuccess = async (decodedText) => {
    const liveAccess = getEventAccessStatus(selectedEvent);
    if (!liveAccess.isOpen) {
      showToast(`Cannot log attendance. This assembly event is ${liveAccess.label.toLowerCase()}.`, 'error');
      setScanning(false);
      return;
    }

    try {
      const studentData = JSON.parse(decodedText);

      if (studentData.type !== 'ATENDER_STUDENT_PROFILE') {
        showToast('Invalid QR Code. Please scan the student member QR from Settings.', 'error');
        return;
      }

      if (!selectedEventId) {
        showToast('Please select a target assembly event first.', 'error');
        return;
      }

      const activeOrg = getOrgConfig(selectedOrgId);
      const targetClient = getSubOrgClient(selectedOrgId);

      let targetStudentDbId = null;
      let studentCourse = (studentData.course || '').toUpperCase();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const profileQuery = supabase.from('profiles').select('id, course, full_name, student_id');
      let profileData = null;

      if (uuidRegex.test(studentData.studentId)) {
        const { data } = await profileQuery.eq('id', studentData.studentId).maybeSingle();
        profileData = data;
      } else {
        const { data } = await profileQuery.eq('student_id', studentData.studentId).maybeSingle();
        profileData = data;
        if (!profileData) {
          const { data: nameMatch } = await supabase.from('profiles').select('id, course, full_name, student_id').eq('full_name', studentData.name).maybeSingle();
          profileData = nameMatch;
        }
      }

      if (!profileData?.id) {
        throw new Error(`Could not find student profile for ID: ${studentData.studentId}`);
      }

      targetStudentDbId = profileData.id;
      if (profileData.course) {
        studentCourse = profileData.course.toUpperCase();
      }

      // Department & Organization Strict Validation
      if (selectedOrgId.includes('pice') || activeOrg.code === 'PICE') {
        if (!studentCourse.includes('BSCE') && !studentCourse.includes('CIVIL')) {
          showToast(`Access Denied: You are not a PICE (Civil Engineering) student!`, 'error');
          return;
        }
      } else if (selectedOrgId.includes('iiee') || activeOrg.code === 'IIEE') {
        if (!studentCourse.includes('BSEE') && !studentCourse.includes('ELECTRICAL')) {
          showToast(`Access Denied: You are not an IIEE (Electrical Engineering) student!`, 'error');
          return;
        }
      } else if (selectedEvent && (selectedEvent.organization_type || selectedEvent.target_department)) {
        const targetDept = (selectedEvent.organization_type || selectedEvent.target_department).toUpperCase();
        if (targetDept !== 'ALL' && !studentCourse.includes(targetDept)) {
          showToast(`Access Denied: This event is restricted to ${targetDept} students only.`, 'error');
          return;
        }
      }

      // Already Logged / Duplicate Attendance Check
      const { data: existingLog } = await targetClient
        .from(activeOrg.attendanceTable)
        .select('id, time_in')
        .eq('event_id', selectedEventId)
        .eq('student_id', targetStudentDbId)
        .maybeSingle();

      if (existingLog) {
        showToast(`Notice: ${profileData.full_name || studentData.name} has already logged attendance for this event!`, 'error');
        return;
      }

      // Save Attendance Payload to Secondary Database
      const attendancePayload = {
        event_id: selectedEventId,
        student_id: targetStudentDbId,
        status: 'present',
        time_in: new Date().toISOString()
      };

      if (selectedOrgId === 'fco-main-federation') {
        attendancePayload.organization_id = null;
      }

      const { error: attError } = await targetClient
        .from(activeOrg.attendanceTable)
        .insert(attendancePayload);

      if (attError) throw attError;

      const scanResult = {
        name: profileData.full_name || studentData.name,
        studentId: profileData.student_id || studentData.studentId,
        course: studentCourse,
        yearSec: `${studentData.yearLevel || ''} ${studentData.section || ''}`.trim(),
        timestamp: new Date().toLocaleTimeString(),
        chapter: activeOrg.code
      };

      setLastScanned(scanResult);
      showToast(`Successfully logged attendance for: ${scanResult.name}!`);

    } catch (err) {
      console.error("Attendance logging error:", err);
      showToast(err.message || 'Failed to record attendance.', 'error');
    }
  };

  const onScanError = () => {};

  // KUNG WALA PANG SESSION, IPALABAS ANG HIWALAY NA LOGIN COMPONENT
  if (!session) {
    return <Login onLogin={handleLoginSuccess} showToast={showToast} />;
  }

  // Scanner Portal View
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', padding: '32px 16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      
      {toast.show && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999 }}>
          <div style={{ padding: '14px 20px', borderRadius: '14px', backgroundColor: toast.type === 'error' ? '#fee2e2' : '#ecfdf5', color: toast.type === 'error' ? '#991b1b' : '#065f46', border: `1px solid ${toast.type === 'error' ? '#fecaca' : '#a7f3d0'}`, fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
            {toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        <div style={{ backgroundColor: '#ffffff', padding: '24px 28px', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: '#8b0000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', boxShadow: '0 4px 10px rgba(139, 0, 0, 0.2)' }}>
              <ShieldCheck size={26} />
            </div>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>
                Atender Admin Scanner ({adminRole?.toUpperCase()} MODE)
              </h1>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', margin: 0, fontWeight: '600' }}>Logged in as: {session.user.email}</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '30px', backgroundColor: isOnline ? '#ecfdf5' : '#fef2f2', border: `1px solid ${isOnline ? '#a7f3d0' : '#fecaca'}` }}>
              <Wifi size={15} color={isOnline ? '#059669' : '#dc2626'} />
              <span style={{ fontSize: '11px', fontWeight: '800', color: isOnline ? '#065f46' : '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <button onClick={handleLogout} style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', padding: '9px 16px', borderRadius: '12px', fontWeight: '800', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase' }}>
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>

        {isEventClosed && selectedEvent && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '16px 22px', borderRadius: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ padding: '8px', borderRadius: '10px', backgroundColor: '#fee2e2' }}>
              <Lock size={22} color="#dc2626" />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: '900', color: '#991b1b', margin: 0, textTransform: 'uppercase' }}>Assembly is {currentAccess.label}</p>
              <p style={{ fontSize: '11px', color: '#b91c1c', margin: '2px 0 0 0', fontWeight: '600' }}>This event window is not currently active. Scanning is locked.</p>
            </div>
          </div>
        )}

        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
                <Building size={14} color="#64748b" /> Entity / Chapter (Locked by Role)
              </label>
              <select
                value={selectedOrgId}
                disabled={adminRole !== 'fco'}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', background: '#f8fafc', color: '#0f172a', outline: 'none', cursor: adminRole !== 'fco' ? 'not-allowed' : 'pointer' }}
              >
                {SUB_ORGANIZATIONS
                  .filter(org => {
                    if (adminRole === 'iiee') return org.id.includes('iiee') || org.code === 'IIEE';
                    if (adminRole === 'pice') return org.id.includes('pice') || org.code === 'PICE';
                    return true;
                  })
                  .map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
                <Calendar size={14} color="#64748b" /> Target Assembly Event
              </label>
              <select
                value={selectedEventId}
                onChange={(e) => { setSelectedEventId(e.target.value); setScanning(false); }}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', background: '#f8fafc', color: '#0f172a', outline: 'none', cursor: 'pointer' }}
              >
                <option value="">-- Choose Assembly --</option>
                {events.map((evt) => {
                  const access = getEventAccessStatus(evt);
                  return (
                    <option key={evt.id} value={evt.id}>
                      {evt.title} [{access.label}]
                    </option>
                  );
                })}
              </select>
            </div>

          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '18px' }}>
            <button
              onClick={() => {
                if (!selectedEventId) {
                  showToast('Please select an assembly event first.', 'error');
                  return;
                }
                const liveAccess = getEventAccessStatus(selectedEvent);
                if (!liveAccess.isOpen) {
                  showToast(`Cannot start scanner. Event is ${liveAccess.label.toLowerCase()}.`, 'error');
                  return;
                }
                setScanning(!scanning);
              }}
              disabled={isEventClosed}
              style={{ 
                backgroundColor: isEventClosed ? '#cbd5e1' : '#8b0000', 
                color: '#ffffff', 
                padding: '13px 30px', 
                borderRadius: '14px', 
                fontWeight: '900', 
                fontSize: '12px', 
                textTransform: 'uppercase', 
                border: 'none', 
                cursor: isEventClosed ? 'not-allowed' : 'pointer', 
                boxShadow: isEventClosed ? 'none' : '0 4px 12px rgba(139, 0, 0, 0.25)', 
                letterSpacing: '0.8px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
            >
              {scanning ? <Lock size={16} /> : <Unlock size={16} />}
              {scanning ? 'Stop Scanner' : 'Start Live Scanner'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', alignItems: 'start' }}>
          
          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', marginBottom: '16px', letterSpacing: '0.5px' }}>Camera Viewport</h3>
            {scanning && !isEventClosed ? (
              <div id="reader" style={{ width: '100%', borderRadius: '14px', overflow: 'hidden', border: '1px solid #e2e8f0' }} />
            ) : (
              <div style={{ height: '300px', backgroundColor: '#f8fafc', borderRadius: '14px', border: '2px dashed #cbd5e1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: '12px' }}>
                <QrCode size={44} strokeWidth={1.5} />
                <p style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px' }}>
                  {isEventClosed ? `Locked (${currentAccess.label})` : 'Scanner is idle'}
                </p>
              </div>
            )}
          </div>

          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', marginBottom: '16px', letterSpacing: '0.5px' }}>Successfully Logged Present</h3>

            {lastScanned ? (
              <div style={{ padding: '20px', backgroundColor: '#ecfdf5', borderRadius: '14px', border: '1px solid #a7f3d0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UserCheck size={18} color="#059669" />
                  <span style={{ fontSize: '11px', fontWeight: '900', color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attendance Recorded ({lastScanned.chapter})</span>
                </div>
                <div style={{ borderTop: '1px solid #a7f3d0', paddingTop: '12px' }}>
                  <p style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a', margin: '0 0 2px 0' }}>{lastScanned.name}</p>
                  <p style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: '900', color: '#8b0000', margin: '0 0 6px 0' }}>{lastScanned.studentId}</p>
                  <p style={{ fontSize: '11px', color: '#475569', fontWeight: '700', margin: 0 }}>{lastScanned.course} • {lastScanned.yearSec}</p>
                  <p style={{ fontSize: '10px', color: '#059669', fontWeight: '800', marginTop: '6px' }}>Time In: {lastScanned.timestamp}</p>
                </div>
              </div>
            ) : (
              <div style={{ height: '300px', backgroundColor: '#f8fafc', borderRadius: '14px', border: '2px dashed #cbd5e1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', padding: '20px', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px' }}>Scan a student's Settings QR code to manually log attendance.</p>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
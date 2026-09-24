import React, { useState, useEffect } from 'react';
import { supabase, IIEE_ORG_ID } from '../services/supabase'; // Corrected path
import { attendanceClient } from '../lib/attendanceClient';
import { CheckCircle2, AlertTriangle, Camera, Search, X, ShieldAlert, Clock, UserCheck, ChevronLeft, ChevronRight } from 'lucide-react';

export default function AttendanceTab({ currentUser }) {
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('ALL');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Pagination States (Limited to 10 per page)
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Manual Attendance Modal States
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualEventId, setManualEventId] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualStudentSearch, setManualStudentSearch] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // Filters (Dropdowns for Program, Year, Section)
  const [searchQuery, setSearchQuery] = useState('');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');

  // Selected Student for Right Drawer
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchEventsList();
    fetchStudentsList();
  }, []);

  useEffect(() => {
    setCurrentPage(1); // Reset to page 1 on event filter change
    fetchAttendanceData();

    const channel = attendanceClient
      .channel('realtime_iiee_admin_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'iiee_attendance' },
        () => fetchAttendanceData()
      )
      .subscribe();

    return () => {
      attendanceClient.removeChannel(channel);
    };
  }, [selectedEventId]);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3500);
  };

  const fetchEventsList = async () => {
    try {
      const { data, error } = await attendanceClient
        .from('iiee_events')
        .select('id, title, start_time, end_time, fine_amount')
        .eq('organization_id', IIEE_ORG_ID)
        .order('start_time', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
      if (data && data.length > 0) {
        setSelectedEventId(data[0].id);
        setManualEventId(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching IIEE events:', err);
    }
  };

  const fetchStudentsList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, student_id, course')
        .or('course.ilike.%BSEE%,course.ilike.%ELECTRICAL%')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setStudents(data || []);
    } catch (err) {
      console.error('Error fetching BSEE student list:', err);
    }
  };

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);

      let attQuery = attendanceClient
        .from('iiee_attendance')
        .select(`
          id,
          event_id,
          student_id,
          time_in,
          time_out,
          created_at,
          proof_photo_url
        `)
        .order('time_in', { ascending: false });

      if (selectedEventId && selectedEventId !== 'ALL') {
        attQuery = attQuery.eq('event_id', selectedEventId);
      }

      const { data: attData, error: attErr } = await attQuery;
      if (attErr) throw attErr;

      if (!attData || attData.length === 0) {
        setAttendanceLogs([]);
        setSelectedLog(null);
        setLoading(false);
        return;
      }

      const studentIds = [...new Set(attData.map(a => a.student_id))];
      const eventIds = [...new Set(attData.map(a => a.event_id))];

      const [profilesRes, eventsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, student_id, course, year_level, section, avatar_url')
          .in('id', studentIds),
        attendanceClient
          .from('iiee_events')
          .select('id, title, fine_amount')
          .in('id', eventIds)
      ]);

      const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));
      const eventMap = new Map((eventsRes.data || []).map(e => [e.id, e]));

      const formattedData = attData.map(item => ({
        ...item,
        profiles: profileMap.get(item.student_id) || null,
        events: eventMap.get(item.event_id) || null
      }));

      setAttendanceLogs(formattedData);

      if (formattedData.length > 0) {
        setSelectedLog((prev) => {
          if (!prev) return formattedData[0];
          return formattedData.find((l) => l.id === prev.id) || formattedData[0];
        });
      } else {
        setSelectedLog(null);
      }
    } catch (err) {
      console.error('Error loading IIEE attendance logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAttendanceSubmit = async (e) => {
    e.preventDefault();
    if (!manualEventId || !manualStudentId) {
      showToast('Please select both an event and a student.', 'error');
      return;
    }

    setManualSubmitting(true);
    try {
      const { error } = await attendanceClient.rpc('admin_override_iiee_attendance_present', {
        p_event_id: manualEventId,
        p_student_id: manualStudentId,
      });

      if (error) throw error;

      showToast('Student successfully marked present and IIEE fines waived!');
      setManualModalOpen(false);
      setManualStudentId('');
      setManualStudentSearch('');
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Failed to record manual IIEE attendance.', 'error');
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleDeleteAttendance = async (log) => {
    const studentName = log.profiles?.full_name || 'this student';
    const eventTitle = log.events?.title || 'the event';
    const fineAmount = parseFloat(log.events?.fine_amount || 0);

    const confirmed = window.confirm(
      `Reject attendance proof for ${studentName}?\n\n` +
      `• The attendance record will be DELETED.\n` +
      `• The student will be marked ABSENT.\n` +
      `• An unpaid IIEE penalty of ₱${fineAmount.toFixed(2)} will be immediately applied for "${eventTitle}".`
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      const { data: res, error } = await attendanceClient.rpc('admin_invalidate_iiee_attendance', {
        p_attendance_id: log.id,
      });

      if (error || (res && res.success === false)) {
        throw new Error(res?.message || error?.message || 'Failed to reject IIEE attendance.');
      }

      showToast(`Attendance rejected. ₱${fineAmount.toFixed(2)} IIEE fine applied to ${studentName}.`);
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Error invalidating IIEE attendance.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filteredLogs = attendanceLogs.filter((log) => {
    const prof = log.profiles || {};
    const name = (prof.full_name || '').toLowerCase();
    const sId = (prof.student_id || '').toLowerCase();
    const course = (prof.course || '').toUpperCase();
    const year = prof.year_level?.toString() || '';
    const section = (prof.section || '').toUpperCase();

    const matchesSearch = name.includes(searchQuery.toLowerCase()) || sId.includes(searchQuery.toLowerCase());
    const matchesProgram = programFilter === 'ALL' || course.includes(programFilter);
    const matchesYear = yearFilter === 'ALL' || year === yearFilter;
    const matchesSection = sectionFilter === 'ALL' || section === sectionFilter;

    return matchesSearch && matchesProgram && matchesYear && matchesSection;
  });

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE) || 1;
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filteredModalStudents = students.filter((stu) => {
    const name = (stu.full_name || '').toLowerCase();
    const sId = (stu.student_id || '').toLowerCase();
    const query = manualStudentSearch.toLowerCase();
    return name.includes(query) || sId.includes(query);
  });

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {toast.show && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999 }}>
          <div style={{
            padding: '12px 18px',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            border: '1px solid',
            fontSize: '13px',
            fontWeight: '600',
            backgroundColor: toast.type === 'error' ? '#fee2e2' : '#fefde8',
            color: toast.type === 'error' ? '#991b1b' : '#854d0e',
            borderColor: toast.type === 'error' ? '#fecaca' : '#fde047'
          }}>
            <span>{toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* 1. ACTION BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>IIEE Attendance Audit & Verification</h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '400' }}>
            Inspect real-time BSEE student check-ins, verify selfie photo proofs, or manually assign IIEE attendance.
          </p>
        </div>
        <button
          onClick={() => setManualModalOpen(true)}
          style={{ backgroundColor: '#854d0e', color: '#ffffff', padding: '10px 18px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(133, 77, 14, 0.15)' }}
        >
          <UserCheck size={15} />
          <span>Manual Attendance</span>
        </button>
      </div>

      {/* 2. FILTER AND SEARCH BAR */}
      <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>Event:</span>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer', flex: 1 }}
          >
            <option value="ALL">All IIEE Assemblies</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {evt.title}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <input
            type="text"
            placeholder="Search BSEE student name or ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', outline: 'none', fontWeight: '400' }}
          />
          <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={programFilter}
            onChange={(e) => { setProgramFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Program: All</option>
            <option value="BSEE">BSEE</option>
          </select>

          <select
            value={yearFilter}
            onChange={(e) => { setYearFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Year: All</option>
            <option value="1">1st Year</option>
            <option value="2">2nd Year</option>
            <option value="3">3rd Year</option>
            <option value="4">4th Year</option>
          </select>

          <select
            value={sectionFilter}
            onChange={(e) => { setSectionFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Section: All</option>
            <option value="A">Section A</option>
            <option value="B">Section B</option>
            <option value="C">Section C</option>
          </select>
        </div>
      </div>

      {/* 3. TWO-PANE LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', alignItems: 'start' }}>
        {/* LEFT PANE: ATTENDANCE RECORDS LIST */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Logged BSEE Students ({filteredLogs.length})
            </span>
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#64748b' }}>Click record to inspect</span>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase' }}>
              Loading IIEE attendance logs...
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase' }}>
              No IIEE attendance records found.
            </div>
          ) : (
            <div>
              {paginatedLogs.map((log) => {
                const isSelected = selectedLog?.id === log.id;
                const student = log.profiles || {};
                const logTime = log.time_in || log.time_out || log.created_at;

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isSelected ? '#fefce8' : '#ffffff',
                      borderLeft: isSelected ? '4px solid #854d0e' : '4px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '50%', backgroundColor: '#e2e8f0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: '700', fontSize: '12px', color: '#475569' }}>
                        {student.avatar_url ? (
                          <img src={student.avatar_url} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          student.full_name?.charAt(0) || 'S'
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontWeight: '600', color: '#0f172a', margin: '0 0 2px 0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student.full_name || 'Registered Student'}</p>
                        <p style={{ fontSize: '11px', color: '#64748b', margin: 0, fontWeight: '400', fontFamily: 'monospace' }}>{student.student_id || 'ID Pending'}</p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
                      <span style={{ fontSize: '10px', fontWeight: '600', backgroundColor: '#ecfdf5', color: '#065f46', padding: '3px 8px', borderRadius: '6px', border: '1px solid #a7f3d0' }}>
                        {new Date(logTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls (10 items per page) */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: currentPage === 1 ? '#f1f5f9' : '#fff', color: currentPage === 1 ? '#94a3b8' : '#334155', fontSize: '11px', fontWeight: '700', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage >= totalPages}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: currentPage >= totalPages ? '#f1f5f9' : '#fff', color: currentPage >= totalPages ? '#94a3b8' : '#334155', fontSize: '11px', fontWeight: '700', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* RIGHT PANE: DETAIL & PHOTO PROOF DRAWER */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>IIEE Verification & Photo Proof</h3>
            <span style={{ fontSize: '10px', fontWeight: '600', backgroundColor: '#fefde8', color: '#854d0e', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fde047' }}>
              {selectedLog ? 'Inspecting' : 'No Selection'}
            </span>
          </div>

          {!selectedLog ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '12px', fontWeight: '500' }}>
              Select a student from the list to view attendance photo proof and details.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#cbd5e1', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px', color: '#334155', flexShrink: 0 }}>
                  {selectedLog.profiles?.avatar_url ? (
                    <img src={selectedLog.profiles.avatar_url} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    selectedLog.profiles?.full_name?.charAt(0) || 'S'
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', margin: '0 0 2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedLog.profiles?.full_name}</h4>
                  <p style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: '600', color: '#854d0e', margin: 0 }}>{selectedLog.profiles?.student_id || 'ID Pending'}</p>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                  <Camera size={14} /> Selfie Attendance Proof
                </label>
                <div style={{ width: '100%', height: '220px', borderRadius: '12px', backgroundColor: '#0f172a', overflow: 'hidden', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selectedLog.proof_photo_url ? (
                    <img src={selectedLog.proof_photo_url} alt="Proof" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '16px' }}>
                      <Camera size={28} style={{ opacity: 0.6, margin: '0 auto 6px auto' }} />
                      <p style={{ fontSize: '11px', marginTop: '4px', fontWeight: '500' }}>No selfie photo recorded (Manually assigned).</p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                <div style={{ padding: '10px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <p style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', margin: '0 0 2px 0' }}>Program</p>
                  <p style={{ fontWeight: '700', color: '#0f172a', margin: 0 }}>{selectedLog.profiles?.course || 'BSEE'}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <p style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', margin: '0 0 2px 0' }}>Year & Sec</p>
                  <p style={{ fontWeight: '700', color: '#0f172a', margin: 0 }}>
                    {selectedLog.profiles?.year_level ? `${selectedLog.profiles.year_level}` : ''}{selectedLog.profiles?.section || ''}
                  </p>
                </div>
              </div>

              <div style={{ padding: '10px 12px', backgroundColor: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={15} color="#059669" />
                <div>
                  <p style={{ fontSize: '10px', fontWeight: '700', color: '#065f46', textTransform: 'uppercase', margin: '0 0 1px 0' }}>Time Logged In</p>
                  <p style={{ fontSize: '12px', fontWeight: '800', color: '#064e3b', margin: 0 }}>
                    {new Date(selectedLog.time_in || selectedLog.time_out || selectedLog.created_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </p>
                </div>
              </div>

              <div style={{ paddingTop: '6px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  onClick={() => handleDeleteAttendance(selectedLog)}
                  disabled={deleting}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer', opacity: deleting ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <ShieldAlert size={14} />
                  <span>{deleting ? 'Processing...' : 'Reject Proof & Issue IIEE Fine'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MANUAL ATTENDANCE MODAL */}
      {manualModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '440px', width: '100%', padding: '28px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0 }}>Manual IIEE Attendance</h3>
              <button onClick={() => setManualModalOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '18px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
            </div>

            <form onSubmit={handleManualAttendanceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>Select IIEE Event</label>
                <select
                  required
                  value={manualEventId}
                  onChange={(e) => setManualEventId(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#f8fafc', fontWeight: '600', boxSizing: 'border-box' }}
                >
                  <option value="">-- Choose IIEE Assembly --</option>
                  {events.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      {evt.title} ({new Date(evt.start_time).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>Search BSEE Student</label>
                <div style={{ position: 'relative', marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="Type name or student ID..."
                    value={manualStudentSearch}
                    onChange={(e) => setManualStudentSearch(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', outline: 'none' }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
                <select
                  required
                  size={4}
                  value={manualStudentId}
                  onChange={(e) => setManualStudentId(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#f8fafc', fontWeight: '500', boxSizing: 'border-box' }}
                >
                  <option value="">-- Choose Student from Results --</option>
                  {filteredModalStudents.map((stu) => (
                    <option key={stu.id} value={stu.id}>
                      {stu.full_name} ({stu.student_id || 'No ID'})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setManualModalOpen(false)} style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={manualSubmitting} style={{ flex: 1, backgroundColor: '#854d0e', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', opacity: manualSubmitting ? 0.5 : 1 }}>{manualSubmitting ? 'Recording...' : 'Mark Present'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
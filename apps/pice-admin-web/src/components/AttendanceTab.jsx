import React, { useState, useEffect } from 'react';
import { piceClient, PICE_ORG_ID } from '../services/piceClient';
import { supabase } from '../services/supabase';
import { CheckCircle2, AlertTriangle, Camera, Search, X, ShieldAlert, Clock, UserCheck, ChevronLeft, ChevronRight, Download } from 'lucide-react';

export default function AttendanceTab({ currentUser }) {
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('ALL');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualEventId, setManualEventId] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualStudentSearch, setManualStudentSearch] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');

  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchEventsList();
    fetchStudentsList();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    fetchAttendanceData();

    const channel = piceClient
      .channel('realtime_pice_admin_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pice_attendance' },
        () => fetchAttendanceData()
      )
      .subscribe();

    return () => {
      piceClient.removeChannel(channel);
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
      const { data, error } = await piceClient
        .from('pice_events')
        .select('id, title, start_time, end_time, fine_amount')
        .eq('organization_id', PICE_ORG_ID)
        .order('start_time', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
      if (data && data.length > 0) {
        setSelectedEventId(data[0].id);
        setManualEventId(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching PICE events:', err);
    }
  };

  const fetchStudentsList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, student_id, course')
        .or('course.ilike.%BSCE%,course.ilike.%CIVIL%')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setStudents(data || []);
    } catch (err) {
      console.error('Error fetching BSCE student list:', err);
    }
  };

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);

      let attQuery = piceClient
        .from('pice_attendance')
        .select('*')
        .order('time_in', { ascending: false });

      if (selectedEventId && selectedEventId !== 'ALL') {
        attQuery = attQuery.eq('event_id', selectedEventId);
      }

      const { data: rawAttendance, error: attError } = await attQuery;
      if (attError) throw attError;

      if (!rawAttendance || rawAttendance.length === 0) {
        setAttendanceLogs([]);
        setSelectedLog(null);
        return;
      }

      const studentIds = [...new Set(rawAttendance.map((a) => a.student_id).filter(Boolean))];
      
      const { data: profilesData, error: profError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', studentIds);

      if (profError) throw profError;

      const eventIds = [...new Set(rawAttendance.map((a) => a.event_id).filter(Boolean))];
      
      const { data: eventsData, error: evError } = await piceClient
        .from('pice_events')
        .select('*')
        .in('id', eventIds);

      if (evError) throw evError;

      const profileMap = {};
      (profilesData || []).forEach((p) => {
        profileMap[p.id] = p;
      });

      const eventMap = {};
      (eventsData || []).forEach((e) => {
        eventMap[e.id] = e;
      });

      const mergedLogs = rawAttendance.map((item) => ({
        ...item,
        profiles: profileMap[item.student_id] || {
          full_name: 'Unknown Student',
          student_id: 'N/A',
          course: 'BSCE',
        },
        events: eventMap[item.event_id] || null,
      }));

      setAttendanceLogs(mergedLogs);

      if (mergedLogs.length > 0) {
        setSelectedLog((prev) => {
          if (!prev) return mergedLogs[0];
          return mergedLogs.find((l) => l.id === prev.id) || mergedLogs[0];
        });
      } else {
        setSelectedLog(null);
      }
    } catch (err) {
      console.error('Error loading PICE attendance logs:', err);
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
      const { error } = await piceClient.rpc('admin_override_pice_attendance_present', {
        p_event_id: manualEventId,
        p_student_id: manualStudentId,
      });

      if (error) throw error;

      showToast('Student successfully marked present and PICE fines waived!');
      setManualModalOpen(false);
      setManualStudentId('');
      setManualStudentSearch('');
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Failed to record manual PICE attendance.', 'error');
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
      `• An unpaid PICE penalty of ₱${fineAmount.toFixed(2)} will be immediately applied for "${eventTitle}".`
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      const { data: res, error } = await piceClient.rpc('admin_invalidate_pice_attendance', {
        p_attendance_id: log.id,
      });

      if (error || (res && res.success === false)) {
        throw new Error(res?.message || error?.message || 'Failed to reject PICE attendance.');
      }

      showToast(`Attendance rejected. ₱${fineAmount.toFixed(2)} PICE fine applied to ${studentName}.`);
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Error invalidating PICE attendance.', 'error');
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

  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + pageSize);

  const filteredModalStudents = students.filter((stu) => {
    const name = (stu.full_name || '').toLowerCase();
    const sId = (stu.student_id || '').toLowerCase();
    const query = manualStudentSearch.toLowerCase();
    return name.includes(query) || sId.includes(query);
  });

  const handleDownloadPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups for this website to generate the PDF preview.');
      return;
    }

    const currentEventObj = events.find((e) => e.id === selectedEventId);
    const eventTitleDisplay = selectedEventId === 'ALL' ? 'All PICE Assemblies' : (currentEventObj?.title || 'Selected PICE Event');
    const filterDesc = `Event: ${eventTitleDisplay} | Program: ${programFilter} | Year: ${yearFilter} | Section: ${sectionFilter}`;

    const rowsHtml = filteredLogs.map((log, idx) => {
      const studentName = log.profiles?.full_name || 'N/A';
      const studentIdNum = log.profiles?.student_id || 'N/A';
      const studentCourse = log.profiles?.course || 'BSCE';
      const studentYearSec = `${log.profiles?.year_level || ''}${log.profiles?.section || ''}`;
      const timeFormatted = new Date(log.time_in || log.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${studentName}</strong></td>
          <td><code>${studentIdNum}</code></td>
          <td>${studentCourse} - ${studentYearSec}</td>
          <td>${timeFormatted}</td>
          <td><span style="color: #059669; font-weight: bold;">PRESENT</span></td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>PICE Official Attendance Roster</title>
          <style>
            @page { size: A4 portrait; margin: 15mm; }
            body { font-family: sans-serif; padding: 0; margin: 0; color: #0f172a; background: #ffffff; }
            .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #b45309; padding-bottom: 14px; margin-bottom: 16px; }
            .logo { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid #b45309; }
            .title-block h1 { font-size: 18px; font-weight: 900; margin: 0; text-transform: uppercase; color: #b45309; }
            .title-block p { font-size: 11px; color: #64748b; margin: 3px 0 0 0; }
            .meta { font-size: 11px; color: #475569; margin-bottom: 16px; font-weight: 700; display: flex; justify-content: space-between; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
            th { background-color: #f8fafc; color: #475569; border-bottom: 2px solid #cbd5e1; padding: 8px 10px; text-transform: uppercase; font-size: 10px; }
            td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; color: #1e293b; }
            tr:nth-child(even) { background-color: #fcfcfc; }
            .footer { margin-top: 24px; text-align: right; font-size: 10px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="/PICE-LOGO.jpg" alt="PICE Logo" class="logo" onerror="this.style.display='none'" />
            <div class="title-block">
              <h1>PICE - ESSU Attendance Audit Report</h1>
              <p>Official Verified Check-Ins & Telemetry Logs</p>
            </div>
          </div>
          <div class="meta">
            <span><strong>Filters:</strong> ${filterDesc}</span>
            <span><strong>Total Logged:</strong> ${filteredLogs.length}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">No.</th>
                <th>Student Full Name</th>
                <th>Student Number</th>
                <th>Program / Year & Sec</th>
                <th>Time Logged In</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="footer">
            Atender Multi-Departmental System &bull; Generated on: ${new Date().toLocaleDateString()}
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

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
            backgroundColor: toast.type === 'error' ? '#fee2e2' : '#ecfdf5',
            color: toast.type === 'error' ? '#991b1b' : '#065f46',
            borderColor: toast.type === 'error' ? '#fecaca' : '#a7f3d0'
          }}>
            <span>{toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>PICE Attendance Audit & Verification</h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '400' }}>
            Inspect real-time BSCE student check-ins, verify selfie photo proofs, or manually assign PICE attendance.
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleDownloadPDF}
            style={{ backgroundColor: '#b45309', color: '#ffffff', padding: '10px 16px', borderRadius: '10px', fontWeight: '700', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(180, 83, 9, 0.2)' }}
          >
            <Download size={15} />
            <span>Download PDF Roster</span>
          </button>

          <button
            onClick={() => setManualModalOpen(true)}
            style={{ backgroundColor: '#4a0404', color: '#ffffff', padding: '10px 18px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(74, 4, 4, 0.15)' }}
          >
            <UserCheck size={15} />
            <span>Manual Attendance</span>
          </button>
        </div>
      </div>

      <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>Event:</span>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer', flex: 1 }}
          >
            <option value="ALL">All PICE Assemblies</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>{evt.title}</option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <input
            type="text"
            placeholder="Search BSCE student name or ID..."
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
            <option value="BSCE">BSCE</option>
            <option value="CIVIL">Civil</option>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', alignItems: 'start' }}>
        <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Logged BSCE Students ({filteredLogs.length})
            </span>
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#64748b' }}>Page {currentPage} of {totalPages}</span>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase' }}>
              Loading PICE attendance logs...
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase' }}>
              No PICE attendance records found.
            </div>
          ) : (
            <div>
              <div style={{ minHeight: '420px' }}>
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
                        backgroundColor: isSelected ? '#fef2f2' : '#ffffff',
                        borderLeft: isSelected ? '4px solid #4a0404' : '4px solid transparent',
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

              <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '11px', fontWeight: '700', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px', color: '#334155' }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '11px', fontWeight: '700', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px', color: '#334155' }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>PICE Verification & Photo Proof</h3>
            <span style={{ fontSize: '10px', fontWeight: '600', backgroundColor: '#fef2f2', color: '#4a0404', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fecaca' }}>
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
                  <p style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: '600', color: '#4a0404', margin: 0 }}>{selectedLog.profiles?.student_id || 'ID Pending'}</p>
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
                  <p style={{ fontWeight: '700', color: '#0f172a', margin: 0 }}>{selectedLog.profiles?.course || 'BSCE'}</p>
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
                  <span>{deleting ? 'Processing...' : 'Reject Proof & Issue PICE Fine'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {manualModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '440px', width: '100%', padding: '28px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0 }}>Manual PICE Attendance</h3>
              <button onClick={() => setManualModalOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '18px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
            </div>

            <form onSubmit={handleManualAttendanceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>Select PICE Event</label>
                <select
                  required
                  value={manualEventId}
                  onChange={(e) => setManualEventId(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#f8fafc', fontWeight: '600', boxSizing: 'border-box' }}
                >
                  <option value="">-- Choose PICE Assembly --</option>
                  {events.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      {evt.title} ({new Date(evt.start_time).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>Search BSCE Student</label>
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
                <button type="submit" disabled={manualSubmitting} style={{ flex: 1, backgroundColor: '#4a0404', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', opacity: manualSubmitting ? 0.5 : 1 }}>{manualSubmitting ? 'Recording...' : 'Mark Present'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect, useTransition } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { logAdminAction } from '../../lib/auditLogger';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function AttendanceTab({ currentUser }) {
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('ALL');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [, startTransition] = useTransition();

  // Manual Attendance Modal States
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualEventId, setManualEventId] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualStudentSearch, setManualStudentSearch] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // PDF Preview States
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Selected Student for Right Drawer
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchEventsList();
    fetchStudentsList();
  }, []);

  useEffect(() => {
    fetchAttendanceData();

    const channel = supabase
      .channel('realtime_admin_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => fetchAttendanceData())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => fetchAttendanceData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedEventId, debouncedSearch, programFilter, yearFilter, sectionFilter, page]);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3500);
  };

  const fetchEventsList = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, fine_amount')
        .order('start_time', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
      if (data && data.length > 0) {
        setSelectedEventId(data[0].id);
        setManualEventId(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  };

  const fetchStudentsList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, student_id, course')
        .order('full_name', { ascending: true })
        .limit(2000);

      if (error) throw error;
      setStudents(data || []);
    } catch (err) {
      console.error('Error fetching student list:', err);
    }
  };

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_paginated_attendance_logs', {
        p_event_id: selectedEventId === 'ALL' ? null : selectedEventId,
        p_search: debouncedSearch,
        p_program: programFilter,
        p_year: yearFilter,
        p_section: sectionFilter,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });

      if (error) throw error;

      const logs = data || [];
      startTransition(() => {
        setAttendanceLogs(logs);
        if (logs.length > 0) {
          setSelectedLog((prev) => (prev ? logs.find((l) => l.id === prev.id) || logs[0] : logs[0]));
        } else {
          setSelectedLog(null);
        }
      });
    } catch (err) {
      console.error('Error loading attendance logs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper to convert image URL to base64 so jsPDF can embed it cleanly
  const getBase64ImageFromURL = (url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = (error) => reject(error);
      img.src = url;
    });
  };

  // 🚀 GENERATE PDF BLOB WITH UNIVERSITY LOGO & HEADER
  const handleOpenPdfPreview = async () => {
    try {
      setGeneratingPdf(true);
      showToast('Preparing PDF preview...');

      const { data: allLogs, error } = await supabase.rpc('get_paginated_attendance_logs', {
        p_event_id: selectedEventId === 'ALL' ? null : selectedEventId,
        p_search: debouncedSearch,
        p_program: programFilter,
        p_year: yearFilter,
        p_section: sectionFilter,
        p_limit: 5000,
        p_offset: 0,
      });

      if (error) throw error;

      const doc = new jsPDF('p', 'mm', 'a4');
      const activeEvent = events.find((e) => e.id === selectedEventId);
      const eventTitle = selectedEventId === 'ALL' ? 'All Events & Assemblies' : activeEvent?.title || 'Assembly Event';

      // Try adding the university logo image from your public folder or source reference
      try {
        // Adjust the path to where your logo is stored in your public directory (e.g., '/logo.png')
        const logoBase64 = await getBase64ImageFromURL('src/assets/FCO-LOGOO.png');
        doc.addImage(logoBase64, 'PNG', 14, 10, 16, 16);
      } catch (e) {
        console.warn('Logo image could not be loaded into PDF, skipping image placeholder:', e);
      }

      // Header Branding matching user layout specification
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(139, 0, 0); // #8b0000
      doc.text('EASTERN SAMAR STATE UNIVERSITY', 34, 17);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('FCO-COE ATENDER ATTENDANCE REPORT', 34, 23);

      // Sub-details
      doc.setFontSize(9);
      doc.text(`Event: ${eventTitle}`, 14, 32);
      doc.text(`Filters: Program: ${programFilter} | Year: ${yearFilter} | Section: ${sectionFilter}`, 14, 38);
      doc.text(`Generated On: ${new Date().toLocaleString()} | Total: ${allLogs?.length || 0}`, 14, 44);

      const tableRows = (allLogs || []).map((log, index) => {
        const student = log.profiles || {};
        const timeLogged = new Date(log.time_in || log.time_out).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return [
          index + 1,
          student.student_id || 'N/A',
          student.full_name || 'Unknown Student',
          `${student.course || 'COE'} ${student.year_level || ''}${student.section || ''}`,
          timeLogged,
          'PRESENT',
        ];
      });

      autoTable(doc, {
        startY: 50,
        head: [['No.', 'Student ID', 'Full Name', 'Program/Yr/Sec', 'Time Logged', 'Status']],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [139, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });

      const pdfOutput = doc.output('bloburl');
      setPdfBlobUrl(pdfOutput);
      setPreviewModalOpen(true);
    } catch (err) {
      console.error('PDF preview generation error:', err);
      showToast('Failed to generate PDF preview.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadFromPreview = () => {
    if (!pdfBlobUrl) return;
    const activeEvent = events.find((e) => e.id === selectedEventId);
    const link = document.createElement('a');
    link.href = pdfBlobUrl;
    link.download = `Atender_Attendance_Report_${selectedEventId === 'ALL' ? 'All_Events' : activeEvent?.title || 'Report'}.pdf`;
    link.click();
    showToast('PDF report downloaded successfully!');
    setPreviewModalOpen(false);
  };

  const handleManualAttendanceSubmit = async (e) => {
    e.preventDefault();
    if (!manualEventId || !manualStudentId) {
      showToast('Please select both an event and a student.', 'error');
      return;
    }

    setManualSubmitting(true);
    try {
      const { error } = await supabase.rpc('admin_override_attendance_present', {
        p_event_id: manualEventId,
        p_student_id: manualStudentId,
      });

      if (error) throw error;

      const targetStudent = students.find((s) => s.id === manualStudentId);
      const targetEvent = events.find((ev) => ev.id === manualEventId);

      await logAdminAction({
        currentUser,
        actionType: 'MANUAL_ATTENDANCE_OVERRIDE',
        module: 'ATTENDANCE',
        targetId: manualStudentId,
        details: {
          student_name: targetStudent?.full_name || 'Unknown Student',
          student_number: targetStudent?.student_id || 'N/A',
          event_title: targetEvent?.title || 'Assembly Event',
        },
      });

      showToast('Student successfully marked present and fines waived!');
      setManualModalOpen(false);
      setManualStudentId('');
      setManualStudentSearch('');
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Failed to record manual attendance.', 'error');
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
      `• An unpaid penalty of ₱${fineAmount.toFixed(2)} will be immediately applied for "${eventTitle}".`
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      const { data: res, error } = await supabase.rpc('admin_invalidate_attendance', {
        p_attendance_id: log.id,
      });

      if (error || (res && res.success === false)) {
        throw new Error(res?.message || error?.message || 'Failed to reject attendance.');
      }

      await logAdminAction({
        currentUser,
        actionType: 'REJECT_ATTENDANCE',
        module: 'ATTENDANCE',
        targetId: log.id,
        details: {
          student_name: studentName,
          student_id: log.profiles?.student_id,
          event_title: eventTitle,
          fine_issued: fineAmount,
        },
      });

      showToast(`Attendance rejected. ₱${fineAmount.toFixed(2)} fine applied to ${studentName}.`);
      await fetchAttendanceData();
    } catch (err) {
      showToast(err.message || 'Error invalidating attendance.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filteredModalStudents = students.filter((stu) => {
    const name = (stu.full_name || '').toLowerCase();
    const sId = (stu.student_id || '').toLowerCase();
    const query = manualStudentSearch.toLowerCase();
    return name.includes(query) || sId.includes(query);
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-6 right-6 z-[100] animate-bounce">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border text-xs font-bold ${
              toast.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* 1. TOP BAR WITH PDF PREVIEW BUTTON */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Attendance Audit & Verification</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Inspect real-time student check-ins, verify selfie photo proofs, or preview and export official PDF reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Event:</span>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full md:w-56 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000] cursor-pointer"
            >
              <option value="ALL">All Events & Assemblies</option>
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {evt.title}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleOpenPdfPreview}
            disabled={generatingPdf}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>{generatingPdf ? 'Generating...' : 'Preview PDF Report'}</span>
          </button>

          <button
            onClick={() => setManualModalOpen(true)}
            className="px-4 py-2.5 bg-[#8b0000] hover:bg-[#700000] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md shadow-[#8b0000]/20 flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Manual Attendance</span>
          </button>
        </div>
      </div>

      {/* 2. FILTER & SEARCH BAR WITH SECTION DROPDOWN */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between">
        <div className="w-full lg:w-80 relative">
          <input
            type="text"
            placeholder="Search student number or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
          />
          <svg
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/80">
            {['ALL', 'BSCE', 'BSEE', 'BSCpE'].map((dept) => (
              <button
                key={dept}
                onClick={() => setProgramFilter(dept)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  programFilter === dept ? 'bg-[#8b0000] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 cursor-pointer"
          >
            <option value="ALL">All Year Levels</option>
            <option value="1">1st Year</option>
            <option value="2">2nd Year</option>
            <option value="3">3rd Year</option>
            <option value="4">4th Year</option>
          </select>

          {/* Section Dropdown */}
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 cursor-pointer"
          >
            <option value="ALL">All Sections</option>
            <option value="A">Section A</option>
            <option value="B">Section B</option>
            <option value="C">Section C</option>
            <option value="D">Section D</option>
          </select>
        </div>
      </div>

      {/* 3. TWO-PANE LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT PANE: ATTENDANCE RECORDS */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
              Loaded Logs ({attendanceLogs.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                Prev
              </button>
              <span className="text-xs font-bold text-slate-600">Page {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={attendanceLogs.length < pageSize}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
              Loading attendance logs...
            </div>
          ) : attendanceLogs.length === 0 ? (
            <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
              No attendance records found.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
              {attendanceLogs.map((log) => {
                const isSelected = selectedLog?.id === log.id;
                const student = log.profiles || {};
                const logTime = log.time_in || log.time_out || log.created_at;

                return (
                  <button
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className={`w-full p-4 flex items-center justify-between text-left transition cursor-pointer ${
                      isSelected ? 'bg-red-50/70 border-l-4 border-l-[#8b0000]' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {student.avatar_url ? (
                          <img src={student.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-black text-xs text-slate-600">
                            {student.full_name?.charAt(0) || 'S'}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{student.full_name || 'Registered Student'}</p>
                        <p className="text-[11px] font-mono text-slate-400">{student.student_id || 'ID Pending'}</p>
                        <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                          {student.course || 'COE'} • {student.year_level || ''} - Sec {student.section || 'N/A'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 ml-3">
                      <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-700 font-black text-[10px] uppercase rounded-md border border-emerald-200">
                        Logged: {new Date(logTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT PANE: DETAIL & SELFIE PHOTO PROOF DRAWER */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6 sticky top-6">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">
              Verification & Photo Proof
            </h3>
            <span className="text-[10px] font-extrabold uppercase text-[#8b0000] bg-red-50 px-2 py-0.5 rounded border border-red-100">
              {selectedLog ? 'Inspecting Log' : 'No Selection'}
            </span>
          </div>

          {!selectedLog ? (
            <div className="py-12 text-center text-slate-400 text-xs font-semibold">
              Select a student from the list to view attendance photo proof and full records.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-12 h-12 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {selectedLog.profiles?.avatar_url ? (
                    <img src={selectedLog.profiles.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-black text-base text-slate-600">
                      {selectedLog.profiles?.full_name?.charAt(0) || 'S'}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-slate-900 truncate">
                    {selectedLog.profiles?.full_name || 'Registered Student'}
                  </h4>
                  <p className="text-xs font-mono font-bold text-[#8b0000]">
                    {selectedLog.profiles?.student_id || 'ID Pending'}
                  </p>
                  <p className="text-[11px] text-slate-500 font-medium truncate">
                    {selectedLog.events?.title || 'Assembly Event'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Selfie Attendance Proof</span>
                </label>
                <div className="w-full h-64 rounded-2xl bg-slate-900 overflow-hidden border border-slate-200 flex items-center justify-center relative shadow-inner">
                  {selectedLog.proof_photo_url ? (
                    <img
                      src={selectedLog.proof_photo_url}
                      alt="Selfie Attendance Proof"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-4">
                      <svg className="w-8 h-8 text-slate-500 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-slate-400 text-xs font-semibold mt-1">
                        No selfie photo proof recorded (Manually assigned).
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Program</p>
                  <p className="font-black text-slate-800 mt-0.5">{selectedLog.profiles?.course || 'COE'}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Year & Section</p>
                  <p className="font-black text-slate-800 mt-0.5">
                    {selectedLog.profiles?.year_level ? `${selectedLog.profiles.year_level}th` : ''} - Sec {selectedLog.profiles?.section || 'N/A'}
                  </p>
                </div>

                <div className="col-span-2 p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase">Time Logged At</p>
                  <p className="font-black text-emerald-900 mt-0.5">
                    {new Date(selectedLog.time_in || selectedLog.time_out || selectedLog.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={() => handleDeleteAttendance(selectedLog)}
                  disabled={deleting}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>{deleting ? 'Processing...' : 'Reject Proof & Issue Fine'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PDF PREVIEW MODAL */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-black text-slate-800 uppercase tracking-wide text-xs">
                Attendance Report PDF Preview
              </h3>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="flex-1 bg-slate-100 p-4">
              {pdfBlobUrl ? (
                <iframe src={pdfBlobUrl} className="w-full h-full rounded-xl border border-slate-200" title="PDF Preview" />
              ) : (
                <div className="flex items-center justify-center h-full text-xs font-bold text-slate-400">
                  Loading preview...
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-white">
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleDownloadFromPreview}
                className="px-5 py-2.5 bg-[#8b0000] hover:bg-[#700000] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md cursor-pointer flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Confirm & Download PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL ATTENDANCE MODAL */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="font-black text-slate-800 uppercase tracking-wide text-sm">
                Manual Attendance Assignment
              </h3>
              <button
                onClick={() => setManualModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleManualAttendanceSubmit} className="space-y-4 mt-4 text-xs font-bold uppercase text-slate-700">
              <div>
                <label className="block mb-1.5">Select Event</label>
                <select
                  required
                  value={manualEventId}
                  onChange={(e) => setManualEventId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                >
                  <option value="">-- Choose Event / Assembly --</option>
                  {events.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      {evt.title} ({new Date(evt.start_time).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1.5">Search & Select Student</label>
                <input
                  type="text"
                  placeholder="Type student name or ID..."
                  value={manualStudentSearch}
                  onChange={(e) => setManualStudentSearch(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 placeholder-slate-400 mb-2 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                />
                <select
                  required
                  size={4}
                  value={manualStudentId}
                  onChange={(e) => setManualStudentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                >
                  <option value="">-- Choose Student from Results --</option>
                  {filteredModalStudents.map((stu) => (
                    <option key={stu.id} value={stu.id}>
                      {stu.full_name} ({stu.student_id || 'No ID'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setManualModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="px-5 py-2.5 bg-[#8b0000] hover:bg-[#700000] text-white font-bold rounded-xl tracking-wider uppercase transition shadow-md cursor-pointer"
                >
                  {manualSubmitting ? 'Recording...' : 'Mark Present'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect, useTransition } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../lib/supabaseClient';
import fcoLogo from '../../assets/FCO-LOGOO.png';
import { logAdminAction } from '../../lib/auditLogger';

export default function ReportsTab({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reportType, setReportType] = useState('ALL'); // 'ALL' | 'ATTENDANCE' | 'ABSENTEE'

  // Pagination states
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [, startTransition] = useTransition();

  // PDF Preview Modal States
  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfDocInstance, setPdfDocInstance] = useState(null);

  // Master Raw State
  const [paginatedStudents, setPaginatedStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [fines, setFines] = useState([]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchEventsAndAuxData();
  }, [semesterFilter]);

  useEffect(() => {
    fetchPaginatedReportData();

    const channel = supabase
      .channel('realtime_reports_master_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => fetchPaginatedReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fines' }, () => fetchPaginatedReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => fetchPaginatedReportData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedEventId, semesterFilter, debouncedSearch, programFilter, yearFilter, sectionFilter, page]);

  const fetchEventsAndAuxData = async () => {
    try {
      let eventsQuery = supabase
        .from('events')
        .select('*')
        .order('start_time', { ascending: false });

      if (semesterFilter !== 'ALL') {
        eventsQuery = eventsQuery.eq('semester', semesterFilter);
      }

      const { data: evData } = await eventsQuery;
      setEvents(evData || []);

      const { data: attData } = await supabase.from('attendance').select('*');
      setAttendance(attData || []);

      const { data: fnData } = await supabase.from('fines').select('*');
      setFines(fnData || []);
    } catch (err) {
      console.error('Error fetching auxiliary data:', err);
    }
  };

  const fetchPaginatedReportData = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.rpc('get_paginated_reports', {
        p_semester: semesterFilter,
        p_event_id: selectedEventId,
        p_search: debouncedSearch,
        p_program: programFilter,
        p_year: yearFilter,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });

      if (error) throw error;
      
      // Apply local section filtering if selected
      const filtered = (data || []).filter(stu => {
        if (sectionFilter === 'ALL') return true;
        return String(stu.section || '').toLowerCase() === sectionFilter.toLowerCase();
      });

      startTransition(() => {
        setPaginatedStudents(filtered);
      });
    } catch (err) {
      console.error('Error fetching paginated reports:', err);
    } finally {
      setLoading(false);
    }
  };

  const compileRowsForStudents = (studentList) => {
    return studentList.map((student) => {
      const relevantEvents = selectedEventId === 'ALL'
        ? events
        : events.filter((e) => String(e.id) === String(selectedEventId));

      const studentAttendance = attendance.filter((a) => {
        const isThisStudent = String(a.student_id) === String(student.id);
        const isTargetEvent = selectedEventId === 'ALL' || String(a.event_id) === String(selectedEventId);
        const isInCurrentEventsList = events.some(e => String(e.id) === String(a.event_id));
        return isThisStudent && isTargetEvent && isInCurrentEventsList && (a.time_in || a.status === 'present');
      });

      const studentDbFines = fines.filter((f) => {
        const isThisStudent = String(f.student_id) === String(student.id);
        const isTargetEvent = selectedEventId === 'ALL' || String(f.event_id) === String(selectedEventId);
        const isInCurrentEventsList = events.some(e => String(e.id) === String(f.event_id));
        const isUnpaid = String(f.status || '').toLowerCase() === 'unpaid' || String(f.status || '').toLowerCase() === 'pending_approval';
        return isThisStudent && isTargetEvent && isInCurrentEventsList && isUnpaid;
      });

      const isPresent = studentAttendance.length > 0;
      const dbFineTotal = studentDbFines.reduce((sum, f) => sum + (parseFloat(f.amount) || 0), 0);

      let calculatedAbsenceFine = 0;
      relevantEvents.forEach((evt) => {
        const isClosed = new Date(evt.end_time).getTime() <= Date.now() || evt.attendance_access === 'force_closed';
        const hasAttendedThis = attendance.some((a) => String(a.student_id) === String(student.id) && String(a.event_id) === String(evt.id));
        if (isClosed && !hasAttendedThis) {
          calculatedAbsenceFine += parseFloat(evt.fine_amount || 0);
        }
      });

      const unpaidFineTotal = Math.max(dbFineTotal, calculatedAbsenceFine);

      return {
        id: student.id,
        studentId: student.student_id,
        fullName: student.full_name,
        course: student.course || 'COE',
        yearLevel: student.year_level || '',
        section: student.section || '',
        isPresent,
        unpaidFineTotal,
        checkInTime: studentAttendance[0]?.time_in || studentAttendance[0]?.created_at || null,
      };
    });
  };

  const compiledRows = compileRowsForStudents(paginatedStudents);

  const filteredRows = compiledRows.filter((row) => {
    if (reportType === 'ATTENDANCE') return row.isPresent;
    if (reportType === 'ABSENTEE') return !row.isPresent;
    return true;
  });

  const totalReportStudents = filteredRows.length;
  const totalPresent = filteredRows.filter((r) => r.isPresent).length;
  const totalAbsent = totalReportStudents - totalPresent;
  const totalOutstanding = filteredRows.reduce((sum, r) => sum + r.unpaidFineTotal, 0);

  // 🚀 GENERATE PDF DOCUMENT WITH CLEAN PHP TEXT AND PERFECT SPACING
  const buildPdfDocument = async () => {
    let query = supabase.from('profiles').select('*').eq('role', 'student');
    if (debouncedSearch) {
      query = query.or(`full_name.ilike.%${debouncedSearch}%,student_id.ilike.%${debouncedSearch}%`);
    }
    if (programFilter !== 'ALL') query = query.eq('course', programFilter);
    if (sectionFilter !== 'ALL') query = query.ilike('section', sectionFilter);
    if (yearFilter !== 'ALL') query = query.eq('year_level', yearFilter);

    const { data: exportData } = await query.order('created_at', { ascending: false });
    const records = exportData || [];
    const allCompiled = compileRowsForStudents(records);
    const exportFiltered = allCompiled.filter((r) => {
      if (reportType === 'ATTENDANCE') return r.isPresent;
      if (reportType === 'ABSENTEE') return !r.isPresent;
      return true;
    });

    const doc = new jsPDF();
    const img = new Image();
    img.src = fcoLogo;

    const generateTable = (docInstance) => {
      // Header Section
      docInstance.setFontSize(14);
      docInstance.setTextColor(139, 0, 0);
      docInstance.text('EASTERN SAMAR STATE UNIVERSITY', 36, 16);
      
      docInstance.setFontSize(10);
      docInstance.setTextColor(100, 100, 100);
      docInstance.text('FCO-COE STUDENT MASTERLIST & ATTENDANCE REPORT', 36, 23);

      // Metadata lines
      docInstance.setFontSize(9);
      docInstance.setTextColor(70, 70, 70);
      docInstance.text(`Program: ${programFilter} | Year: ${yearFilter} | Section: ${sectionFilter}`, 14, 36);
      docInstance.text(`Generated On: ${new Date().toLocaleDateString()} | Total: ${exportFiltered.length}`, 14, 43);

      // Using 'Fine (PHP)' instead of symbol to prevent font glitching
      const tableColumn = ['No.', 'Student Number', 'Full Name', 'Program / Year & Sec', 'Status', 'Fine'];
      const tableRows = exportFiltered.map((item, index) => [
        index + 1,
        item.studentId || 'N/A',
        item.fullName || 'N/A',
        `${item.course || 'COE'} ${item.yearLevel}${item.section}`,
        item.isPresent ? 'PRESENT' : 'ABSENT',
        item.unpaidFineTotal > 0 ? ` ${item.unpaidFineTotal.toFixed(2)}` : '0.00',
      ]);

      autoTable(docInstance, {
        head: [tableColumn],
        body: tableRows,
        startY: 50,
        theme: 'grid',
        margin: { left: 14, right: 14 },
        headStyles: { 
          fillColor: [139, 0, 0], 
          textColor: [255, 255, 255], 
          fontStyle: 'bold', 
          fontSize: 8.5,
          halign: 'center'
        },
        styles: { fontSize: 8, fontStyle: 'normal', cellPadding: 3, valign: 'middle' },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' }, // No.
          1: { cellWidth: 32, halign: 'left' },   // Student Number
          2: { cellWidth: 58, halign: 'left' },   // Full Name
          3: { cellWidth: 38, halign: 'center' }, // Program / Year & Sec
          4: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // Status
          5: { cellWidth: 20, halign: 'right', textColor: [139, 0, 0] }, // Fine
        },
        didParseCell: function (data) {
          if (data.section === 'body' && data.column.index === 4) {
            if (data.cell.raw === 'PRESENT') {
              data.cell.styles.textColor = [5, 150, 105];
            } else {
              data.cell.styles.textColor = [220, 38, 38];
            }
          }
        },
      });
    };

    return new Promise((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/png');
        doc.addImage(dataURL, 'PNG', 14, 10, 18, 18);
        generateTable(doc);
        resolve(doc);
      };
      img.onerror = () => {
        generateTable(doc);
        resolve(doc);
      };
    });
  };

  const handleOpenPdfPreview = async () => {
    const doc = await buildPdfDocument();
    setPdfDocInstance(doc);
    const pdfBlobUrl = doc.output('bloburl');
    setPdfPreviewUrl(pdfBlobUrl);
    setPdfPreviewModalOpen(true);
  };

  const handleDownloadPDF = async () => {
    try {
      const doc = pdfDocInstance || (await buildPdfDocument());
      doc.save(`Atender_Report_${semesterFilter}_${selectedEventId}_${reportType}.pdf`);

      await logAdminAction({
        currentUser,
        actionType: 'EXPORT_AUDIT_REPORT',
        module: 'REPORTS',
        details: { export_format: 'PDF', total_records: filteredRows.length },
      });
    } catch (err) {
      console.error('Error downloading PDF report:', err);
    }
  };

  const handleExportCSV = async () => {
    const headers = ['Student ID', 'Full Name', 'Program', 'Year & Section', 'Attendance Status', 'Check-In Time', 'Outstanding Fines (PHP)'];
    const csvRows = filteredRows.map((r) => [
      `"${r.studentId}"`,
      `"${r.fullName}"`,
      `"${r.course}"`,
      `"${r.yearLevel}${r.section}"`,
      `"${r.isPresent ? 'PRESENT' : 'ABSENT'}"`,
      `"${r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}"`,
      r.unpaidFineTotal.toFixed(2),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Atender_Report_${semesterFilter}_${selectedEventId}_${reportType}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    await logAdminAction({
      currentUser,
      actionType: 'EXPORT_AUDIT_REPORT',
      module: 'REPORTS',
      details: { export_format: 'CSV', semester: semesterFilter, report_type: reportType, total_records: filteredRows.length },
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. TOP HEADER & ACTION BUTTONS */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-slate-800 tracking-tight">Official Reports & Attendance Audit</h2>
            <span className="px-3 py-1 bg-red-50 text-[#8b0000] border border-red-200 rounded-full text-[10px] font-black uppercase tracking-wider">
              {semesterFilter === 'ALL' ? 'All Semesters' : semesterFilter}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Preview and download vectorized PDF files or export structured CSV sheets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchPaginatedReportData}
            title="Refresh database records"
            className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer"
          >
            ↻
          </button>

          <button
            onClick={handleExportCSV}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleOpenPdfPreview}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>Preview & Download PDF</span>
          </button>
        </div>
      </div>

      {/* 2. STAT SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 print:hidden">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Page Count</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{totalReportStudents}</p>
          <span className="text-[11px] font-semibold text-slate-500 mt-0.5 inline-block">Loaded Students</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Present Count</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{totalPresent}</p>
          <span className="text-[11px] font-semibold text-emerald-600 mt-0.5 inline-block">
            {totalReportStudents > 0 ? Math.round((totalPresent / totalReportStudents) * 100) : 0}% Turnout
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Absentee Count</p>
          <p className="text-2xl font-black text-red-600 mt-1">{totalAbsent}</p>
          <span className="text-[11px] font-semibold text-red-600 mt-0.5 inline-block">Unexcused</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Fines Assessed</p>
          <p className="text-2xl font-black text-[#8b0000] mt-1">₱{totalOutstanding.toFixed(2)}</p>
          <span className="text-[11px] font-semibold text-amber-600 mt-0.5 inline-block">Unpaid Liabilities</span>
        </div>
      </div>

      {/* 3. REPORT CONFIGURATION & FILTER BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
            {[
              { id: 'ALL', label: 'All Students' },
              { id: 'ATTENDANCE', label: 'Present Only' },
              { id: 'ABSENTEE', label: 'Absent Only' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setReportType(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  reportType === t.id ? 'bg-[#8b0000] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Semester:</span>
              <select
                value={semesterFilter}
                onChange={(e) => setSemesterFilter(e.target.value)}
                className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 cursor-pointer"
              >
                <option value="ALL">All Semesters</option>
                <option value="1st Semester">1st Semester</option>
                <option value="2nd Semester">2nd Semester</option>
                <option value="Summer Term">Summer Term</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Event:</span>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 cursor-pointer"
              >
                <option value="ALL">All Assemblies & Events</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pt-2 border-t border-slate-100">
          <div className="w-full sm:w-80 relative">
            <input
              type="text"
              placeholder="Search student number or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Programs</option>
              <option value="BSCE">BSCE</option>
              <option value="BSEE">BSEE</option>
              <option value="BSCpE">BSCpE</option>
            </select>

            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Years</option>
              <option value="1">1st Year</option>
              <option value="2">2nd Year</option>
              <option value="3">3rd Year</option>
              <option value="4">4th Year</option>
            </select>

            {/* Section Dropdown */}
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Sections</option>
              <option value="A">Section A</option>
              <option value="B">Section B</option>
              <option value="C">Section C</option>
              <option value="D">Section D</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. OFFICIAL REPORT SHEET TABLE WITH PAGINATION */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden p-6 space-y-4">
        {/* Pagination Controls Bar */}
        <div className="flex justify-between items-center pb-3 border-b border-slate-100 print:hidden">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Showing Page {page + 1}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer shadow-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={paginatedStudents.length < pageSize}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer shadow-sm"
            >
              Next
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            Compiling audit logs...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            No student records matching this report configuration on this page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Student Number</th>
                  <th className="px-5 py-3.5">Student Full Name</th>
                  <th className="px-5 py-3.5">Course / Program</th>
                  <th className="px-5 py-3.5">Year & Section</th>
                  <th className="px-5 py-3.5">Attendance Status</th>
                  <th className="px-5 py-3.5">Check-In Time</th>
                  <th className="px-5 py-3.5 text-right">Outstanding Fines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal text-xs">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-5 py-3.5 font-mono text-slate-900">{row.studentId}</td>
                    <td className="px-5 py-3.5 text-slate-900">{row.fullName}</td>
                    <td className="px-5 py-3.5 text-slate-800">{row.course}</td>
                    <td className="px-5 py-3.5 font-mono text-slate-700">
                      {row.yearLevel}{row.section}
                    </td>
                    <td className="px-5 py-3.5">
                      {row.isPresent ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                          Absent
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-slate-600">
                      {row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {row.unpaidFineTotal > 0 ? (
                        <span className="text-red-600 font-mono">
                          ₱{row.unpaidFineTotal.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono">₱0.00</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PDF PREVIEW & DOWNLOAD MODAL */}
      {pdfPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full h-[88vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 flex-shrink-0">
              <div className="flex items-center gap-3">
                <img src={fcoLogo} alt="FCO Logo" className="w-8 h-8 object-contain" />
                <div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    PDF Document Preview
                  </h3>
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Inspect formatted table report before saving
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="px-4 py-2 bg-[#8b0000] hover:bg-[#700000] text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Save PDF Document</span>
                </button>
                <button
                  onClick={() => setPdfPreviewModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 font-bold text-xl leading-none cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-200 p-2 overflow-hidden">
              {pdfPreviewUrl ? (
                <iframe
                  src={pdfPreviewUrl}
                  title="PDF Preview"
                  className="w-full h-full rounded-2xl bg-white border-0 shadow-inner"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-500">
                  Generating document stream...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
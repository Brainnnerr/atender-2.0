import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../services/supabase'; // Main FCO database for profiles
import { attendanceClient } from '../lib/attendanceClient'; // Secondary database for IIEE tables

const iieeLogoUrl = '/IIEE-BG.png';
const essuLogoUrl = '/essu-logo-mini.png';

export default function ReportsTab({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('1st Semester');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [reportType, setReportType] = useState('ALL'); // 'ALL' | 'ATTENDANCE' | 'ABSENTEE'

  // PDF Preview Modal States
  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfDocInstance, setPdfDocInstance] = useState(null);

  // Master Raw State
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [fines, setFines] = useState([]);

  useEffect(() => {
    fetchReportData();

    // Realtime synchronization via attendanceClient for IIEE secondary tables
    const channel = attendanceClient
      .channel('realtime_iiee_reports_master_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'iiee_attendance' }, () => fetchReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'iiee_fines' }, () => fetchReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'iiee_events' }, () => fetchReportData())
      .subscribe();

    return () => {
      attendanceClient.removeChannel(channel);
    };
  }, [selectedEventId, semesterFilter]);

  const fetchReportData = async () => {
    try {
      setLoading(true);

      // 1. Construct events query via attendanceClient
      let eventsQuery = attendanceClient
        .from('iiee_events')
        .select('*')
        .order('start_time', { ascending: false });

      if (semesterFilter !== 'ALL') {
        eventsQuery = eventsQuery.eq('semester', semesterFilter);
      }

      // 2. Base attendance query via attendanceClient
      let attendanceQuery = attendanceClient
        .from('iiee_attendance')
        .select('*');

      if (selectedEventId !== 'ALL') {
        attendanceQuery = attendanceQuery.eq('event_id', selectedEventId);
      }

      // 3. Fines query via attendanceClient
      let finesQuery = attendanceClient
        .from('iiee_fines')
        .select('*');

      // Execute network calls across main and secondary databases in parallel
      const [evRes, stRes, attRes, fnRes] = await Promise.all([
        eventsQuery,
        supabase
          .from('profiles')
          .select('*')
          .or('course.ilike.%BSEE%,course.ilike.%ELECTRICAL%')
          .order('full_name', { ascending: true }),
        attendanceQuery,
        finesQuery
      ]);

      setEvents(evRes.data || []);
      setStudents(stRes.data || []);
      setAttendance(attRes.data || []);
      setFines(fnRes.data || []);
    } catch (err) {
      console.error('Error compiling IIEE report data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper to load Logo as Base64 for jsPDF
  const getBase64ImageFromUrl = async (imageUrl) => {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  };

  // Compile Comprehensive Attendance and Fine Audit Rows
  const compiledRows = students.map((student) => {
    const relevantEvents = selectedEventId === 'ALL'
      ? events
      : events.filter((e) => String(e.id) === String(selectedEventId));

    const studentAttendance = attendance.filter((a) => {
      const isThisStudent = String(a.student_id) === String(student.id);
      const isTargetEvent = selectedEventId === 'ALL' || String(a.event_id) === String(selectedEventId);
      const isValidLog = !!(a.time_in || a.time_out || a.created_at || a.status);
      return isThisStudent && isTargetEvent && isValidLog;
    });

    const studentDbFines = fines.filter((f) => {
      const isThisStudent = String(f.student_id) === String(student.id);
      const isTargetEvent = selectedEventId === 'ALL' || String(f.event_id) === String(selectedEventId);
      const isUnpaid = String(f.status || '').toLowerCase() === 'unpaid' || String(f.status || '').toLowerCase() === 'pending_approval';
      return isThisStudent && isTargetEvent && isUnpaid;
    });

    const isPresent = studentAttendance.length > 0;
    const dbFineTotal = studentDbFines.reduce((sum, f) => sum + (parseFloat(f.amount) || 0), 0);

    let calculatedAbsenceFine = 0;
    relevantEvents.forEach((evt) => {
      const isClosed = new Date(evt.end_time).getTime() <= Date.now();
      const hasAttendedThis = attendance.some((a) => 
        String(a.student_id) === String(student.id) && 
        String(a.event_id) === String(evt.id) && 
        (a.time_in || a.time_out || a.created_at || a.status)
      );
      if (isClosed && !hasAttendedThis) {
        calculatedAbsenceFine += parseFloat(evt.fine_amount || 0);
      }
    });

    const unpaidFineTotal = Math.max(dbFineTotal, calculatedAbsenceFine);

    return {
      id: student.id,
      studentId: student.student_id || 'N/A',
      fullName: student.full_name || 'Unknown',
      course: student.course || 'BSEE',
      yearLevel: student.year_level || '',
      section: student.section || '',
      isPresent,
      unpaidFineTotal,
      checkInTime: studentAttendance[0]?.time_in || studentAttendance[0]?.created_at || studentAttendance[0]?.time_out || null,
    };
  });
  
  // Extract unique options for dynamic dropdowns
  const uniquePrograms = ['ALL', ...new Set(compiledRows.map(r => r.course).filter(Boolean))];
  const uniqueYears = ['ALL', ...new Set(compiledRows.map(r => r.yearLevel).filter(Boolean))];
  const uniqueSections = ['ALL', ...new Set(compiledRows.map(r => r.section).filter(Boolean))];

  // Filter Pipeline
  const filteredRows = compiledRows.filter((row) => {
    const sName = (row.fullName || '').toLowerCase();
    const sId = (row.studentId || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();

    const matchesSearch = sName.includes(q) || sId.includes(q);
    const matchesProgram = programFilter === 'ALL' || row.course === programFilter;
    const matchesYear = yearFilter === 'ALL' || String(row.yearLevel) === String(yearFilter);
    const matchesSection = sectionFilter === 'ALL' || String(row.section) === String(sectionFilter);

    const matchesStatus = 
      reportType === 'ATTENDANCE' ? row.isPresent :
      reportType === 'ABSENTEE' ? !row.isPresent : true;

    return matchesSearch && matchesProgram && matchesYear && matchesSection && matchesStatus;
  });

  // Summary Metrics
  const totalReportStudents = filteredRows.length;
  const totalPresent = filteredRows.filter((r) => r.isPresent).length;
  const totalAbsent = totalReportStudents - totalPresent;
  const totalOutstanding = filteredRows.reduce((sum, r) => sum + r.unpaidFineTotal, 0);

  // Generate jsPDF Document Builder with IIEE and ESSU Logos
  const buildPdfDocument = async () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const currentEventTitle = selectedEventId === 'ALL'
      ? 'All Configured Assemblies'
      : events.find((e) => String(e.id) === String(selectedEventId))?.title || 'Selected Event';

    const pageWidth = doc.internal.pageSize.getWidth();

    const base64Iiee = await getBase64ImageFromUrl(iieeLogoUrl);
    if (base64Iiee) {
      doc.addImage(base64Iiee, 'PNG', 45, 34, 46, 46);
    }

    const base64Essu = await getBase64ImageFromUrl(essuLogoUrl);
    if (base64Essu) {
      doc.addImage(base64Essu, 'PNG', pageWidth - 45 - 46, 34, 46, 46);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('INSTITUTE OF INTEGRATED ELECTRICAL ENGINEERS', pageWidth / 2, 48, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 138);
    doc.text('ESSU STUDENT CHAPTER • COLLEGE OF ENGINEERING', pageWidth / 2, 60, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(133, 77, 14); // IIEE Bronze Accent
    doc.text('OFFICIAL IIEE ATTENDANCE & COMPLIANCE SUMMARY REPORT', pageWidth / 2, 80, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Semester: ${semesterFilter} | Event: ${currentEventTitle} | Scope: ${reportType}`, pageWidth / 2, 93, { align: 'center' });

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(45, 108, pageWidth - 90, 26, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Total Students: ${filteredRows.length}`, 60, 124);
    doc.setTextColor(5, 150, 105);
    doc.text(`Present: ${filteredRows.filter((r) => r.isPresent).length}`, 185, 124);
    doc.setTextColor(220, 38, 38);
    doc.text(`Absent: ${filteredRows.filter((r) => !r.isPresent).length}`, 300, 124);
    doc.setTextColor(133, 77, 14);
    doc.text(`Fines Assessed: PHP ${filteredRows.reduce((sum, r) => sum + r.unpaidFineTotal, 0).toFixed(2)}`, 405, 124);

    const tableColumns = [
      { header: 'Student ID', dataKey: 'studentId' },
      { header: 'Full Name', dataKey: 'fullName' },
      { header: 'Program', dataKey: 'course' },
      { header: 'Yr & Sec', dataKey: 'yearSec' },
      { header: 'Status', dataKey: 'status' },
      { header: 'Check-In', dataKey: 'checkIn' },
      { header: 'Fine (PHP)', dataKey: 'fines' },
    ];

    const tableRows = filteredRows.map((r) => ({
      studentId: r.studentId,
      fullName: r.fullName,
      course: r.course,
      yearSec: `${r.yearLevel}${r.section}`,
      status: r.isPresent ? 'PRESENT' : 'ABSENT',
      checkIn: r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
      fines: r.unpaidFineTotal > 0 ? `PHP ${r.unpaidFineTotal.toFixed(2)}` : '0.00',
    }));

    autoTable(doc, {
      startY: 144,
      margin: { left: 45, right: 45 },
      columns: tableColumns,
      body: tableRows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4.5, textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [133, 77, 14], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        studentId: { cellWidth: 70, font: 'courier', fontStyle: 'bold' },
        fullName: { cellWidth: 140, fontStyle: 'bold' },
        course: { cellWidth: 50, halign: 'center' },
        yearSec: { cellWidth: 55, halign: 'center' },
        status: { cellWidth: 65, halign: 'center', fontStyle: 'bold' },
        checkIn: { cellWidth: 65, halign: 'center' },
        fines: { cellWidth: 77, halign: 'right', fontStyle: 'bold', textColor: [133, 77, 14] },
      },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.dataKey === 'status') {
          if (data.cell.raw === 'PRESENT') {
            data.cell.styles.textColor = [5, 150, 105];
          } else {
            data.cell.styles.textColor = [220, 38, 38];
          }
        }
      },
    });

    return doc;
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
      doc.save(`IIEE_Report_${semesterFilter}_${selectedEventId}_${reportType}.pdf`);
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
    link.setAttribute('download', `IIEE_Report_${semesterFilter}_${selectedEventId}_${reportType}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* 1. TOP HEADER & ACTION BUTTONS */}
      <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', margin: 0 }}>IIEE Reports & Attendance Audit</h2>
            <span style={{ padding: '4px 10px', backgroundColor: '#fefde8', color: '#854d0e', border: '1px solid #fde047', borderRadius: '20px', fontSize: '10px', fontWeight: '900', textTransform: 'uppercase' }}>
              {semesterFilter === 'ALL' ? 'All Semesters' : semesterFilter}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', margin: '4px 0 0 0' }}>
            Preview and download vectorized PDF files, export structured CSV sheets, or print directly.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={fetchReportData}
            title="Refresh database records"
            style={{ padding: '9px 12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
          >
            ↻
          </button>
          <button
            onClick={handleExportCSV}
            style={{ backgroundColor: '#f1f5f9', color: '#334155', padding: '10px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Export CSV
          </button>
          <button
            onClick={handleOpenPdfPreview}
            style={{ backgroundColor: '#854d0e', color: '#ffffff', padding: '10px 16px', borderRadius: '8px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 4px rgba(133, 77, 14, 0.15)' }}
          >
            Preview & Download PDF
          </button>
          <button
            onClick={handlePrint}
            style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '10px 16px', borderRadius: '8px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}
          >
            Print Report
          </button>
        </div>
      </div>

      {/* 2. STAT SUMMARY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Total Enrolled</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', margin: '4px 0 0 0' }}>{totalReportStudents}</p>
        </div>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Present Count</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#059669', margin: '4px 0 0 0' }}>{totalPresent}</p>
        </div>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Absentee Count</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#dc2626', margin: '4px 0 0 0' }}>{totalAbsent}</p>
        </div>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Total Fines Assessed</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#854d0e', margin: '4px 0 0 0' }}>₱{totalOutstanding.toFixed(2)}</p>
        </div>
      </div>

      {/* 3. REPORT CONFIGURATION & FILTER BAR */}
      <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: '#f8fafc', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          {[
            { id: 'ALL', label: 'All Students' },
            { id: 'ATTENDANCE', label: 'Present Only' },
            { id: 'ABSENTEE', label: 'Absent Only' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setReportType(t.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '10px',
                fontWeight: '700',
                textTransform: 'uppercase',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: reportType === t.id ? '#854d0e' : 'transparent',
                color: reportType === t.id ? '#ffffff' : '#64748b',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="1st Semester">Semester: 1st Semester</option>
            <option value="2nd Semester">Semester: 2nd Semester</option>
            <option value="Summer Term">Semester: Summer Term</option>
            <option value="ALL">Semester: All</option>
          </select>

          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Event: All Assemblies</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>{evt.title}</option>
            ))}
          </select>

          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Program: All</option>
            {uniquePrograms.filter(p => p !== 'ALL').map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Year: All</option>
            {uniqueYears.filter(y => y !== 'ALL').map(y => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>

          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Section: All</option>
            {uniqueSections.filter(s => s !== 'ALL').map(s => (
              <option key={s} value={s}>Section {s}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search BSEE student..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', outline: 'none' }}
          />
        </div>
      </div>

      {/* 4. OFFICIAL REPORT SHEET TABLE */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>
            Compiling audit logs...
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>
            No BSEE student records matching this report configuration.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
                  <th style={{ padding: '14px 20px' }}>Student Number</th>
                  <th style={{ padding: '14px 20px' }}>Full Name</th>
                  <th style={{ padding: '14px 20px' }}>Program</th>
                  <th style={{ padding: '14px 20px' }}>Yr & Sec</th>
                  <th style={{ padding: '14px 20px' }}>Status</th>
                  <th style={{ padding: '14px 20px' }}>Check-In</th>
                  <th style={{ padding: '14px 20px', textAlign: 'right' }}>Fines</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' }}>{row.studentId}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: '#0f172a' }}>{row.fullName}</td>
                    <td style={{ padding: '14px 20px', color: '#334155' }}>{row.course}</td>
                    <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{row.yearLevel}{row.section}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: '900',
                        textTransform: 'uppercase',
                        backgroundColor: row.isPresent ? '#ecfdf5' : '#fef2f2',
                        color: row.isPresent ? '#059669' : '#dc2626',
                        border: `1px solid ${row.isPresent ? '#a7f3d0' : '#fecaca'}`
                      }}>
                        {row.isPresent ? 'Present' : 'Absent'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', fontFamily: 'monospace', color: '#64748b' }}>
                      {row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right', fontWeight: '900', fontFamily: 'monospace', color: '#dc2626' }}>
                      ₱{row.unpaidFineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PDF PREVIEW MODAL */}
      {pdfPreviewModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '100', padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '900px', width: '100%', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', margin: 0 }}>IIEE PDF Audit Report Preview</h3>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button onClick={handleDownloadPDF} style={{ backgroundColor: '#854d0e', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: '800', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Save PDF
                </button>
                <button onClick={() => setPdfPreviewModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>×</button>
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#e2e8f0', padding: '10px' }}>
              {pdfPreviewUrl && <iframe src={pdfPreviewUrl} title="Preview" style={{ width: '100%', height: '100%', borderRadius: '12px', border: 'none', backgroundColor: '#fff' }} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
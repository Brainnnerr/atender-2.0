import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../services/supabase'; // Main FCO database for student profiles
import { piceClient, PICE_ORG_ID } from '../services/piceClient'; // Secondary database for PICE tables
import { 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  X, 
  Calendar, 
  Eye, 
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const piceLogoUrl = '/PICE-LOGO-BG.png';
const essuLogoUrl = '/essu-logo-mini.png';

export default function FineManagementTab({ currentUser }) {
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Advanced dropdown filter states
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('1st Semester');

  // Pagination states (10 items per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  
  // PDF Preview Modal States
  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfDocInstance, setPdfDocInstance] = useState(null);
  
  // Remarks Modal States
  const [remarksModalOpen, setRemarksModalOpen] = useState(false);
  const [selectedStudentForAction, setSelectedStudentForAction] = useState(null);
  const [selectedRemark, setSelectedRemark] = useState('Member');

  useEffect(() => {
    setCurrentPage(1);
    fetchStudentFinesMasterlist();
  }, [semesterFilter]);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3500);
  };

  const fetchStudentFinesMasterlist = async () => {
    try {
      setLoading(true);
      
      const [studRes, evRes, attRes, fineRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, student_id, year_level, section, course')
          .or('course.ilike.%BSCE%,course.ilike.%CIVIL%'),

        piceClient
          .from('pice_events')
          .select('id, title, end_time, fine_amount, semester')
          .eq('organization_id', PICE_ORG_ID),

        piceClient
          .from('pice_attendance')
          .select('student_id, event_id, time_in, status'),

        piceClient
          .from('pice_fines')
          .select('id, amount, status, remarks, student_id, event_id')
          .eq('organization_id', PICE_ORG_ID)
      ]);

      if (studRes.error) throw studRes.error;
      if (evRes.error) throw evRes.error;
      if (attRes.error) throw attRes.error;
      if (fineRes.error) throw fineRes.error;

      const students = studRes.data || [];
      const eventsData = evRes.data || [];
      const attData = attRes.data || [];
      const finesData = fineRes.data || [];

      const aggregatedList = students.map(student => {
        const semesterEvents = eventsData.filter(evt => {
          if (semesterFilter === 'ALL') return true;
          const sem = evt.semester || '1st Semester';
          return sem.toLowerCase() === semesterFilter.toLowerCase();
        });

        let calculatedUnpaidAmount = 0;
        let calculatedPaidAmount = 0;
        let hasPaidRecords = false;
        let studentRemarks = 'Member';
        let studentFineIds = [];
        let missedEventsList = [];

        semesterEvents.forEach(evt => {
          const isClosed = new Date(evt.end_time).getTime() <= Date.now();
          const hasAttended = attData.some(a => 
            String(a.student_id) === String(student.id) && 
            String(a.event_id) === String(evt.id) && 
            (a.time_in || a.status === 'present')
          );

          const existingFine = finesData.find(f => 
            String(f.student_id) === String(student.id) && 
            String(f.event_id) === String(evt.id)
          );

          const fineAmount = parseFloat(evt.fine_amount || 0);

          if (existingFine) {
            studentFineIds.push(existingFine.id);
            if (existingFine.remarks && existingFine.remarks !== 'Admin Rejected Attendance Proof') {
              studentRemarks = existingFine.remarks;
            }
            
            const statusStr = String(existingFine.status || '').toLowerCase();
            if (statusStr === 'paid') {
              hasPaidRecords = true;
              calculatedPaidAmount += parseFloat(existingFine.amount || fineAmount);
            } else if (['unpaid', 'pending_approval'].includes(statusStr)) {
              calculatedUnpaidAmount += parseFloat(existingFine.amount || fineAmount);
              missedEventsList.push(evt.id);
            }
          } else if (isClosed && !hasAttended) {
            calculatedUnpaidAmount += fineAmount;
            missedEventsList.push(evt.id);
          }
        });

        let status = 'unpaid';
        if (calculatedUnpaidAmount === 0 && (hasPaidRecords || calculatedPaidAmount > 0)) {
          status = 'paid';
        } else if (calculatedUnpaidAmount === 0 && semesterEvents.length === 0) {
          status = 'paid';
        }

        const displayAmount = status === 'paid' ? (calculatedPaidAmount || calculatedUnpaidAmount) : calculatedUnpaidAmount;

        return {
          studentId: student.id,
          profiles: student,
          fineIds: studentFineIds,
          missedEvents: missedEventsList,
          amount: displayAmount,
          unpaidAmount: calculatedUnpaidAmount,
          paidAmount: calculatedPaidAmount,
          status: status,
          remarks: studentRemarks
        };
      });

      setFines(aggregatedList);
    } catch (err) {
      console.error('Error fetching sub-org masterlist:', err.message || err);
      showToast('Failed to load student records.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRemarksModal = (studentRecord) => {
    if (parseFloat(studentRecord.unpaidAmount || 0) <= 0) return;
    setSelectedStudentForAction(studentRecord);
    setSelectedRemark('Member');
    setRemarksModalOpen(true);
  };

  const handleConfirmMarkPaid = async () => {
    if (!selectedStudentForAction) return;

    try {
      const studentId = selectedStudentForAction.studentId;
      const semesterEvents = selectedStudentForAction.missedEvents || [];

      // 🚀 Siguruhing lahat ng missed/unpaid events ng estudyante ay mase-save bilang 'paid' sa pice_fines
      for (const eventId of semesterEvents) {
        const { error: upsertErr } = await piceClient
          .from('pice_fines')
          .upsert({
            student_id: studentId,
            event_id: eventId,
            amount: 50.00,
            status: 'paid',
            remarks: selectedRemark,
            organization_id: PICE_ORG_ID
          }, { onConflict: 'student_id,event_id' });

        if (upsertErr) throw upsertErr;
      }

      showToast('PICE fines successfully marked as paid!');
      setRemarksModalOpen(false);
      setSelectedStudentForAction(null);
      fetchStudentFinesMasterlist();
    } catch (err) {
      showToast(err.message || 'Operation failed.', 'error');
    }
  };

  const uniquePrograms = ['ALL', ...new Set(fines.map(f => f.profiles?.course).filter(Boolean))];
  const uniqueYears = ['ALL', ...new Set(fines.map(f => f.profiles?.year_level).filter(Boolean))];
  const uniqueSections = ['ALL', ...new Set(fines.map(f => f.profiles?.section).filter(Boolean))];

  const filteredFines = fines.filter((f) => {
    const student = f.profiles || {};
    const matchesSearch =
      (student.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (student.student_id || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'ALL' || f.status.toLowerCase() === statusFilter.toLowerCase();

    const matchesProgram = programFilter === 'ALL' || student.course === programFilter;
    const matchesYear = yearFilter === 'ALL' || String(student.year_level) === String(yearFilter);
    const matchesSection = sectionFilter === 'ALL' || student.section === sectionFilter;

    return matchesSearch && matchesStatus && matchesProgram && matchesYear && matchesSection;
  });

  const totalPages = Math.ceil(filteredFines.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedFines = filteredFines.slice(startIndex, startIndex + pageSize);

  const totalUnpaidAmount = filteredFines
    .filter(f => f.status === 'unpaid')
    .reduce((sum, f) => sum + parseFloat(f.unpaidAmount || 0), 0);

  const totalPaidAmount = filteredFines
    .filter(f => f.status === 'paid')
    .reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);

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

  const buildPdfDocument = async () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();

    const base64Pice = await getBase64ImageFromUrl(piceLogoUrl);
    if (base64Pice) {
      try {
        doc.addImage(base64Pice, 'PNG', 45, 34, 46, 46);
      } catch (imgErr) {
        console.warn('Could not render PICE logo on PDF:', imgErr);
      }
    }

    const base64Essu = await getBase64ImageFromUrl(essuLogoUrl);
    if (base64Essu) {
      try {
        doc.addImage(base64Essu, 'PNG', pageWidth - 45 - 46, 34, 46, 46);
      } catch (imgErr) {
        console.warn('Could not render ESSU logo on PDF:', imgErr);
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('PHILIPPINE INSTITUTE OF CIVIL ENGINEERS', pageWidth / 2, 48, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('ESSU STUDENT CHAPTER • COLLEGE OF ENGINEERING', pageWidth / 2, 60, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(180, 83, 9);
    doc.text('OFFICIAL PICE STUDENT FINES & SANCTIONS AUDIT REPORT', pageWidth / 2, 80, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Semester: ${semesterFilter} | Scope: ${statusFilter} | Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 93, { align: 'center' });

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(45, 108, pageWidth - 90, 26, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Total Students: ${filteredFines.length}`, 60, 124);
    doc.setTextColor(220, 38, 38);
    doc.text(`Unpaid Total: PHP ${totalUnpaidAmount.toFixed(2)}`, 200, 124);
    doc.setTextColor(5, 150, 105);
    doc.text(`Collected Total: PHP ${totalPaidAmount.toFixed(2)}`, 385, 124);

    const tableColumns = [
      { header: 'Student ID', dataKey: 'studentId' },
      { header: 'Full Name', dataKey: 'fullName' },
      { header: 'Program', dataKey: 'program' },
      { header: 'Yr & Sec', dataKey: 'yearSec' },
      { header: 'Remarks', dataKey: 'remarks' },
      { header: 'Amount (PHP)', dataKey: 'amount' },
      { header: 'Status', dataKey: 'status' },
    ];

    const tableRows = filteredFines.map((f) => ({
      studentId: f.profiles?.student_id || 'N/A',
      fullName: f.profiles?.full_name || 'Unknown',
      program: f.profiles?.course || 'BSCE',
      yearSec: `${f.profiles?.year_level || ''}${f.profiles?.section || ''}`,
      remarks: (f.remarks || 'Member').toUpperCase(),
      amount: `PHP ${parseFloat(f.status === 'unpaid' ? f.unpaidAmount : f.amount || 0).toFixed(2)}`,
      status: f.status.toUpperCase(),
    }));

    autoTable(doc, {
      startY: 144,
      margin: { left: 45, right: 45 },
      columns: tableColumns,
      body: tableRows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4.5, textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [180, 83, 9], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        studentId: { cellWidth: 70, font: 'courier', fontStyle: 'bold' },
        fullName: { cellWidth: 130, fontStyle: 'bold' },
        program: { cellWidth: 55, halign: 'center' },
        yearSec: { cellWidth: 50, halign: 'center' },
        remarks: { cellWidth: 65, halign: 'center', fontStyle: 'bold' },
        amount: { cellWidth: 65, halign: 'right', fontStyle: 'bold', textColor: [180, 83, 9] },
        status: { cellWidth: 87, halign: 'center', fontStyle: 'bold' },
      },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.dataKey === 'status') {
          data.cell.styles.textColor = data.cell.raw === 'PAID' ? [5, 150, 105] : [220, 38, 38];
        }
      },
    });

    return doc;
  };

  const handleOpenPdfPreview = async () => {
    try {
      const doc = await buildPdfDocument();
      setPdfDocInstance(doc);
      const blobUrl = doc.output('bloburl');
      setPdfPreviewUrl(blobUrl);
      setPdfPreviewModalOpen(true);
    } catch (err) {
      console.error('Error generating PDF preview:', err);
      showToast('Failed to generate PDF preview.', 'error');
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const doc = pdfDocInstance || (await buildPdfDocument());
      doc.save(`PICE_Student_Fines_Audit_Report_${semesterFilter.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Error downloading PICE PDF:', err);
      showToast('Failed to download PDF report.', 'error');
    }
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
            backgroundColor: toast.type === 'error' ? '#fee2e2' : '#fef3c7',
            color: toast.type === 'error' ? '#991b1b' : '#b45309',
            borderColor: toast.type === 'error' ? '#fecaca' : '#fde68a'
          }}>
            <span>{toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* TOP METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '22px', fontWeight: '900', color: '#dc2626' }}>₱</span>
          </div>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Total Unpaid PICE Fines ({semesterFilter})</h3>
            <p style={{ fontSize: '24px', fontWeight: '900', color: '#dc2626', margin: '4px 0 0 0' }}>₱{totalUnpaidAmount.toFixed(2)}</p>
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '22px', fontWeight: '900', color: '#059669' }}>₱</span>
          </div>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Total PICE Collected ({semesterFilter})</h3>
            <p style={{ fontSize: '24px', fontWeight: '900', color: '#059669', margin: '4px 0 0 0' }}>₱{totalPaidAmount.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* ACTION BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', margin: 0 }}>PICE Student Fine & Sanction Management</h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', borderRadius: '20px', fontSize: '10px', fontWeight: '900', textTransform: 'uppercase' }}>
              <Calendar size={12} /> {semesterFilter}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '400', margin: '4px 0 0 0' }}>
            Manage BSCE student compliance, filter by program/year/section, and download vectorized PDF audit reports.
          </p>
        </div>
        <button
          onClick={handleOpenPdfPreview}
          style={{ backgroundColor: '#b45309', color: '#ffffff', padding: '10px 18px', borderRadius: '10px', fontWeight: '700', fontSize: '12px', textTransform: 'uppercase', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(180, 83, 9, 0.15)' }}
        >
          <Eye size={15} />
          <span>Preview & Download PDF</span>
        </button>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="Search BSCE student name or ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', outline: 'none' }}
          />
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={programFilter}
            onChange={(e) => { setProgramFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Program: All</option>
            {uniquePrograms.filter(p => p !== 'ALL').map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={yearFilter}
            onChange={(e) => { setYearFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Year: All</option>
            {uniqueYears.filter(y => y !== 'ALL').map(y => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>

          <select
            value={sectionFilter}
            onChange={(e) => { setSectionFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="ALL">Section: All</option>
            {uniqueSections.filter(s => s !== 'ALL').map(s => (
              <option key={s} value={s}>Section {s}</option>
            ))}
          </select>

          <select
            value={semesterFilter}
            onChange={(e) => { setSemesterFilter(e.target.value); setCurrentPage(1); }}
            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer' }}
          >
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
            <option value="ALL">All Semesters</option>
          </select>

          <div style={{ display: 'flex', background: '#f8fafc', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            {['ALL', 'UNPAID', 'PAID'].map((st) => (
              <button
                key={st}
                onClick={() => { setStatusFilter(st); setCurrentPage(1); }}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '10px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: statusFilter === st ? '#b45309' : 'transparent',
                  color: statusFilter === st ? '#ffffff' : '#64748b',
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FINES TABLE WITH PAGINATION */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>
            Loading BSCE student masterlist for {semesterFilter}...
          </div>
        ) : (
          <div>
            <div style={{ overflowX: 'auto', minHeight: '380px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
                    <th style={{ padding: '14px 20px' }}>BSCE Student Info</th>
                    <th style={{ padding: '14px 20px' }}>Remarks</th>
                    <th style={{ padding: '14px 20px' }}>Amount ({semesterFilter})</th>
                    <th style={{ padding: '14px 20px' }}>Payment Status</th>
                    <th style={{ padding: '14px 20px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedFines.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' }}>
                        No BSCE student records found matching your filters for {semesterFilter}.
                      </td>
                    </tr>
                  ) : (
                    paginatedFines.map((f) => {
                      const student = f.profiles || {};
                      const isPaid = f.status === 'paid';
                      const amountVal = parseFloat(f.status === 'unpaid' ? f.unpaidAmount : f.amount || 0);

                      return (
                        <tr key={f.studentId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 20px' }}>
                            <p style={{ fontWeight: '700', color: '#0f172a', margin: '0 0 2px 0' }}>{student.full_name || 'Unknown'}</p>
                            <p style={{ fontSize: '11px', color: '#64748b', margin: 0, fontFamily: 'monospace' }}>ID: {student.student_id || 'N/A'} • {student.course || 'BSCE'} {student.year_level}{student.section}</p>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{ padding: '3px 8px', backgroundColor: '#f1f5f9', color: '#334155', borderRadius: '6px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' }}>
                              {f.remarks || 'Member'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', fontWeight: '900', fontFamily: 'monospace', color: '#0f172a' }}>
                            ₱{amountVal.toFixed(2)}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              padding: '4px 10px',
                              borderRadius: '20px',
                              fontSize: '10px',
                              fontWeight: '900',
                              textTransform: 'uppercase',
                              backgroundColor: isPaid ? '#ecfdf5' : '#fef2f2',
                              color: isPaid ? '#059669' : '#dc2626',
                              border: `1px solid ${isPaid ? '#a7f3d0' : '#fecaca'}`
                            }}>
                              {f.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                            {f.unpaidAmount > 0 ? (
                              <button
                                onClick={() => handleOpenRemarksModal(f)}
                                style={{ backgroundColor: '#059669', color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '11px', cursor: 'pointer', textTransform: 'uppercase' }}
                              >
                                Mark Paid ✓
                              </button>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>No Balance</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION CONTROLS */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '11px', fontWeight: '700', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px', color: '#334155' }}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages || totalPages === 0}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '11px', fontWeight: '700', cursor: (currentPage === totalPages || totalPages === 0) ? 'not-allowed' : 'pointer', opacity: (currentPage === totalPages || totalPages === 0) ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px', color: '#334155' }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* REMARKS SELECTION MODAL */}
      {remarksModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '400px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '24px', boxShadow: '0 20px 25px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', margin: '0 0 4px 0' }}>Select BSCE Student Category / Remark</h3>
            <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '14px' }}>Choose appropriate category before marking as paid:</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {[
                'Member',
                'Athlete',
                "Dean's Lister",
                'Officer',
                'President Lister',
                'IIEE Officer',
                'FCO Officer',
                'ICPEP Officer',
                'PICE Officer',
                'Sub-Org Committee',
                'FCO Committee',
                'Publication (Algorithm)',
                'Others'
              ].map((rem) => (
                <label key={rem} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                  <input
                    type="radio"
                    name="studentRemark"
                    value={rem}
                    checked={selectedRemark === rem}
                    onChange={(e) => setSelectedRemark(e.target.value)}
                  />
                  <span>{rem}</span>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
              <button onClick={() => setRemarksModalOpen(false)} style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConfirmMarkPaid} style={{ flex: 1, backgroundColor: '#b45309', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer' }}>Confirm Paid</button>
            </div>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {pdfPreviewModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '100', padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '900px', width: '100%', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', margin: 0 }}>PICE PDF Audit Report ({semesterFilter})</h3>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button onClick={handleDownloadPDF} style={{ backgroundColor: '#b45309', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: '800', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Download size={14} /> Save PDF Report
                </button>
                <button onClick={() => setPdfPreviewModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
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
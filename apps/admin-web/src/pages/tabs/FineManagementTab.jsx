import React, { useState, useEffect, useTransition } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../lib/supabaseClient';
import { logAdminAction } from '../../lib/auditLogger';
import fcoLogo from '../../assets/FCO-LOGOO.png';

export default function FineManagementTab({ currentUser }) {
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Advanced dropdown filter states
  const [programFilter, setProgramFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('1st Semester');

  // Pagination states
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [, startTransition] = useTransition();

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  
  // PDF Preview Modal States
  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  
  // Remarks Modal States
  const [remarksModalOpen, setRemarksModalOpen] = useState(false);
  const [selectedStudentForAction, setSelectedStudentForAction] = useState(null);
  const [selectedRemark, setSelectedRemark] = useState('Member');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchPaginatedFinesMasterlist();
  }, [semesterFilter, statusFilter, programFilter, yearFilter, sectionFilter, debouncedSearch, page]);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3500);
  };

  const fetchPaginatedFinesMasterlist = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.rpc('get_paginated_fine_masterlist', {
        p_semester: semesterFilter,
        p_status: statusFilter,
        p_program: programFilter,
        p_year: yearFilter,
        p_section: sectionFilter,
        p_search: debouncedSearch,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });

      if (error) throw error;

      // Process and aggregate student fine items
      const aggregatedList = (data || []).map(item => {
        const studentFines = item.student_fines || [];
        
        const unpaidFines = studentFines.filter(f => String(f.status || '').toLowerCase() === 'unpaid');
        const unpaidAmount = unpaidFines.reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);
        const hasPaidRecords = studentFines.some(f => String(f.status || '').toLowerCase() === 'paid');

        let status = 'unpaid';
        let displayAmount = unpaidAmount;

        if (unpaidAmount === 0 && hasPaidRecords) {
          status = 'paid';
          displayAmount = studentFines.reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);
        } else if (unpaidAmount === 0 && studentFines.length === 0) {
          status = 'paid';
          displayAmount = 0;
        }

        const remarks = studentFines[0]?.remarks || 'Member';
        const fineIds = studentFines.map(f => f.id);

        return {
          studentId: item.student_id,
          profiles: {
            id: item.student_id,
            full_name: item.full_name,
            student_id: item.student_number,
            course: item.course,
            year_level: item.year_level,
            section: item.section,
          },
          fineIds: fineIds,
          amount: displayAmount,
          unpaidAmount: unpaidAmount,
          status: status,
          remarks: remarks,
        };
      });

      // Apply client-side status filter if specified
      const finalFiltered = aggregatedList.filter(f => {
        if (statusFilter === 'ALL') return true;
        return f.status.toLowerCase() === statusFilter.toLowerCase();
      });

      startTransition(() => {
        setFines(finalFiltered);
      });
    } catch (err) {
      console.error('Error fetching masterlist:', err.message || err);
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
      if (selectedStudentForAction.fineIds && selectedStudentForAction.fineIds.length > 0) {
        const { error } = await supabase
          .from('fines')
          .update({ 
            status: 'paid',
            remarks: selectedRemark 
          })
          .in('id', selectedStudentForAction.fineIds);

        if (error) throw error;

        const { data: fineRecords } = await supabase
          .from('fines')
          .select('event_id')
          .in('id', selectedStudentForAction.fineIds);

        const eventIdsToHide = [...new Set((fineRecords || []).map(f => f.event_id).filter(Boolean))];

        if (eventIdsToHide.length > 0) {
          await supabase
            .from('events')
            .update({ hidden_from_student: true })
            .in('id', eventIdsToHide);
        }
      }

      showToast('Fines marked as paid successfully!');

      await logAdminAction({
        currentUser,
        actionType: 'UPDATE_STUDENT_FINES_PAID',
        module: 'FINES',
        targetId: selectedStudentForAction.studentId,
        details: { remarks: selectedRemark, status: 'paid', cleared_total: selectedStudentForAction.unpaidAmount },
      });

      setRemarksModalOpen(false);
      setSelectedStudentForAction(null);
      fetchPaginatedFinesMasterlist();
    } catch (err) {
      showToast(err.message || 'Operation failed.', 'error');
    }
  };

  const totalUnpaidAmount = fines
    .filter(f => f.status === 'unpaid')
    .reduce((sum, f) => sum + parseFloat(f.unpaidAmount || 0), 0);

  const totalPaidAmount = fines
    .filter(f => f.status === 'paid')
    .reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);

  // Helper to load logo as Base64 for jsPDF
  const getBase64ImageFromUrl = async (imageUrl) => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Could not load image as base64:', e);
      return null;
    }
  };

 const buildPdfDocument = async () => {
    const doc = new jsPDF();
    const base64Fco = await getBase64ImageFromUrl(fcoLogo);
    
    const generateTable = (docInstance) => {
      // Header Section
      docInstance.setFontSize(14);
      docInstance.setTextColor(139, 0, 0);
      docInstance.text('EASTERN SAMAR STATE UNIVERSITY', 36, 16);
      
      docInstance.setFontSize(10);
      docInstance.setTextColor(100, 100, 100);
      docInstance.text('FCO-COE STUDENT FINES REPORT', 36, 23);

      docInstance.setFontSize(9);
      docInstance.setTextColor(70, 70, 70);
      docInstance.text(`Semester: ${semesterFilter} | Program: ${programFilter} | Year: ${yearFilter} | Section: ${sectionFilter}`, 14, 36);
      docInstance.text(`Generated On: ${new Date().toLocaleDateString()} | Total Records: ${fines.length}`, 14, 43);

      const tableColumns = ['No.', 'Student Number', 'Full Name', 'Program / Year & Sec', 'Status', 'Fine (PHP)'];
      const tableRows = fines.map((f, index) => [
        index + 1,
        f.profiles?.student_id || 'N/A',
        f.profiles?.full_name || 'Unknown',
        `${f.profiles?.course || 'COE'} ${f.profiles?.year_level || ''}${f.profiles?.section || ''}`,
        f.status.toUpperCase(),
        `${parseFloat(f.status === 'unpaid' ? f.unpaidAmount : f.amount || 0).toFixed(2)}`,
      ]);

      autoTable(docInstance, {
        head: [tableColumns],
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
          0: { cellWidth: 12, halign: 'left' }, // No.
          1: { cellWidth: 34, halign: 'left' },   // Student Number
          2: { cellWidth: 60, halign: 'left' },   // Full Name
          3: { cellWidth: 30, halign: 'left' }, // Program / Year & Sec
          4: { cellWidth: 23, halign: 'left', fontStyle: 'bold' }, // Status
          5: { cellWidth: 23, halign: 'center', textColor: [139, 0, 0] }, // Fine (PHP)
        },
        didParseCell: function (data) {
          if (data.section === 'body' && data.column.index === 4) {
            if (data.cell.raw === 'PAID') {
              data.cell.styles.textColor = [5, 150, 105];
            } else {
              data.cell.styles.textColor = [220, 38, 38];
            }
          }
        },
      });
    };

    return new Promise((resolve) => {
      if (base64Fco) {
        doc.addImage(base64Fco, 'PNG', 14, 10, 18, 18);
      }
      generateTable(doc);
      resolve(doc);
    });
  };

  const handleOpenPdfPreview = async () => {
    const doc = await buildPdfDocument();
    const pdfBlobUrl = doc.output('bloburl');
    setPdfPreviewUrl(pdfBlobUrl);
    setPdfPreviewModalOpen(true);
  };

  const handleDownloadPDF = async () => {
    try {
      const doc = await buildPdfDocument();
      doc.save(`Student_Fines_Report_${semesterFilter.replace(/\s+/g, '_')}.pdf`);

      await logAdminAction({
        currentUser,
        actionType: 'EXPORT_AUDIT_REPORT',
        module: 'FINES',
        details: { export_format: 'PDF', semester: semesterFilter, total_records: fines.length },
      });
    } catch (err) {
      console.error('Error downloading PDF:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-6 right-6 z-[100] animate-bounce print:hidden">
          <div className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border text-xs font-bold ${
            toast.type === 'error' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}>
            <span>{toast.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* TOP METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 print:hidden">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-base font-black text-slate-800">Total Unpaid Fines ({semesterFilter})</h3>
          <p className="text-3xl font-black text-red-600 mt-2">₱{totalUnpaidAmount.toFixed(2)}</p>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Pending Collection</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-base font-black text-slate-800">Total Collected ({semesterFilter})</h3>
          <p className="text-3xl font-black text-emerald-600 mt-2">₱{totalPaidAmount.toFixed(2)}</p>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Cleared Sanctions</p>
        </div>
      </div>

      {/* ACTION BAR */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Student Fine & Sanction Management</h2>
            <span className="px-3 py-1 bg-red-50 text-[#8b0000] border border-red-200 rounded-full text-[10px] font-black uppercase tracking-wider">
              {semesterFilter}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Manage student compliance, filter by program/year/section, and preview/download PDF audit reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* SEARCH, STATUS, & DROPDOWN FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between print:hidden">
        <div className="w-full lg:w-72 relative">
          <input
            type="text"
            placeholder="Search student name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Program Dropdown Filter */}
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">Program: All</option>
            <option value="BSCE">BSCE</option>
            <option value="BSEE">BSEE</option>
            <option value="BSCpE">BSCpE</option>
          </select>

          {/* Year Level Dropdown Filter */}
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">Year: All</option>
            <option value="1">Year 1</option>
            <option value="2">Year 2</option>
            <option value="3">Year 3</option>
            <option value="4">Year 4</option>
          </select>

          {/* Section Dropdown Filter */}
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">Section: All</option>
            <option value="A">Section A</option>
            <option value="B">Section B</option>
            <option value="C">Section C</option>
            <option value="D">Section D</option>
          </select>

          {/* Semester Filter Dropdown */}
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
            <option value="ALL">All Semesters</option>
          </select>

          {/* Status Pills */}
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/80">
            {['ALL', 'UNPAID', 'PAID'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition ${
                  statusFilter === st ? 'bg-[#8b0000] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FINES TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Pagination Bar */}
        <div className="flex justify-between items-center p-4 border-b border-slate-100 print:hidden bg-slate-50/50">
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
              disabled={fines.length < pageSize}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer shadow-sm"
            >
              Next
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            Loading student masterlist for {semesterFilter}...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Student Info</th>
                  <th className="px-6 py-4">Remarks</th>
                  <th className="px-6 py-4">Amount ({semesterFilter})</th>
                  <th className="px-6 py-4">Payment Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-xs">
                {fines.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                      No student records found matching your filters for {semesterFilter}.
                    </td>
                  </tr>
                ) : (
                  fines.map((f) => {
                    const student = f.profiles || {};
                    const isPaid = f.status === 'paid';
                    const amountVal = parseFloat(f.status === 'unpaid' ? f.unpaidAmount : f.amount || 0);

                    return (
                      <tr key={f.studentId} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-900 text-sm">{student.full_name || 'Unknown'}</p>
                          <p className="text-slate-400 text-[11px] font-mono mt-0.5">ID: {student.student_id || 'N/A'} • {student.course || 'BSCpE'} {student.year_level}{student.section}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg font-bold text-[10px] uppercase">
                            {f.remarks || 'Member'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-black text-slate-900 font-mono text-sm">₱{amountVal.toFixed(2)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isPaid ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            {f.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {f.unpaidAmount > 0 ? (
                            <button
                              onClick={() => handleOpenRemarksModal(f)}
                              className="px-3.5 py-1.5 rounded-xl font-bold text-[11px] uppercase tracking-wider transition cursor-pointer shadow-sm bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              Mark Paid ✓
                            </button>
                          ) : (
                            <span className="text-slate-300 font-bold uppercase text-[10px]">No Balance</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* REMARKS SELECTION MODAL */}
      {remarksModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4 text-left">
            <h3 className="font-black text-slate-800 uppercase tracking-wide text-xs">
              Select Student Category / Remark
            </h3>
            <p className="text-xs text-slate-500">
              Please choose the appropriate category before marking as paid (this will update status to paid):
            </p>

            <div className="space-y-2 py-2 max-h-60 overflow-y-auto pr-1">
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
                <label key={rem} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                  <input
                    type="radio"
                    name="studentRemark"
                    value={rem}
                    checked={selectedRemark === rem}
                    onChange={(e) => setSelectedRemark(e.target.value)}
                    className="text-[#8b0000] focus:ring-[#8b0000]"
                  />
                  <span className="text-xs font-bold text-slate-800 uppercase">{rem}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setRemarksModalOpen(false)}
                className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMarkPaid}
                className="w-1/2 py-2.5 bg-[#8b0000] hover:bg-[#700000] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Confirm Paid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {pdfPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full h-[88vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 flex-shrink-0">
              <div className="flex items-center gap-3">
                <img src={fcoLogo} alt="FCO Logo" className="w-8 h-8 object-contain" />
                <div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    PDF Audit Report Preview ({semesterFilter})
                  </h3>
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Inspect table format before downloading document
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
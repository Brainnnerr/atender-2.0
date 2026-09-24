import React, { useState, useEffect, useTransition } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../lib/supabaseClient';
import fcoLogo from '../../assets/FCO-LOGOO.png';

export default function SystemLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [selectedLog, setSelectedLog] = useState(null);

  // Admin filter dropdown state for both UI and PDF generation
  const [adminsList, setAdminsList] = useState([]);
  const [selectedAdminEmail, setSelectedAdminEmail] = useState('ALL');

  // Pagination states
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [, startTransition] = useTransition();

  // PDF Preview Modal States
  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchPaginatedLogs();
    fetchAdminsList();

    // Real-time listener for incoming actions within the 3-day window
    const channel = supabase
      .channel('realtime_audit_logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        const logDate = new Date(payload.new.created_at);
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        if (logDate >= threeDaysAgo) {
          setLogs((prev) => [payload.new, ...prev]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [moduleFilter, selectedAdminEmail, debouncedSearch, page]);

  const fetchPaginatedLogs = async () => {
    try {
      setLoading(true);

      const from = page * pageSize;
      const to = from + pageSize - 1;

      // Strictly limit to the last 3 days
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .gte('created_at', threeDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (moduleFilter !== 'ALL') {
        query = query.eq('module', moduleFilter);
      }

      if (selectedAdminEmail !== 'ALL') {
        query = query.eq('actor_email', selectedAdminEmail);
      }

      if (debouncedSearch) {
        query = query.or(`actor_name.ilike.%${debouncedSearch}%,actor_email.ilike.%${debouncedSearch}%,action_type.ilike.%${debouncedSearch}%`);
      }

      const { data, error } = await query.range(from, to);

      if (error) throw error;
      const fetched = data || [];

      startTransition(() => {
        setLogs(fetched);
        if (fetched.length > 0 && (!selectedLog || !fetched.some(l => l.id === selectedLog.id))) {
          setSelectedLog(fetched[0]);
        } else if (fetched.length === 0) {
          setSelectedLog(null);
        }
      });
    } catch (err) {
      console.error('Error fetching paginated system logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminsList = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('role', 'admin');
      setAdminsList(data || []);
    } catch (err) {
      console.error('Error fetching admins list for filter:', err);
    }
  };

  const getModuleBadge = (mod) => {
    switch (mod) {
      case 'EVENTS':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'ATTENDANCE':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'STUDENTS':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'REPORTS':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'ADMINS':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'FINES':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

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
    
    // Fetch logs matching current active filters (Module + Selected Admin)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    let pdfQuery = supabase
      .from('audit_logs')
      .select('*')
      .gte('created_at', threeDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (moduleFilter !== 'ALL') {
      pdfQuery = pdfQuery.eq('module', moduleFilter);
    }
    if (selectedAdminEmail !== 'ALL') {
      pdfQuery = pdfQuery.eq('actor_email', selectedAdminEmail);
    }

    const { data: pdfLogsData } = await pdfQuery;
    const targetLogs = pdfLogsData || [];

    const generateTable = (docInstance) => {
      // Header Section
      docInstance.setFontSize(14);
      docInstance.setTextColor(139, 0, 0);
      docInstance.text('EASTERN SAMAR STATE UNIVERSITY', 36, 16);
      
      docInstance.setFontSize(10);
      docInstance.setTextColor(100, 100, 100);
      docInstance.text('FCO-COE SYSTEM AUDIT LOGS REPORT (3-DAY RETENTION)', 36, 23);

      docInstance.setFontSize(9);
      docInstance.setTextColor(70, 70, 70);
      docInstance.text(`Admin Officer: ${selectedAdminEmail === 'ALL' ? 'All Officers' : selectedAdminEmail} | Module: ${moduleFilter} | Total: ${targetLogs.length}`, 14, 36);
      docInstance.text(`Generated On: ${new Date().toLocaleDateString()}`, 14, 43);

      const tableColumns = ['No.', 'Timestamp', 'Officer Name', 'Module', 'Action Type'];
      const tableRows = targetLogs.map((log, index) => [
        index + 1,
        new Date(log.created_at).toLocaleString(),
        log.actor_name || 'Unknown',
        log.module || 'GENERAL',
        log.action_type || 'UNKNOWN',
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
          0: { cellWidth: 12, halign: 'center' }, // No.
          1: { cellWidth: 42, halign: 'center' }, // Timestamp
          2: { cellWidth: 50, halign: 'left' },   // Officer Name
          3: { cellWidth: 32, halign: 'center', fontStyle: 'bold' }, // Module
          4: { cellWidth: 60, halign: 'left' },   // Action Type
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
      doc.save(`System_Audit_Logs_${selectedAdminEmail.replace(/[@.]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Error downloading PDF logs:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. TOP HEADER & ACTION BAR */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">System Audit & Officer Activity Logs</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Showing audit trails from the <strong className="text-[#8b0000]">last 3 days</strong> (older logs are automatically purged).
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

          <button
            onClick={() => { setPage(0); fetchPaginatedLogs(); }}
            className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* 2. FILTER, SEARCH, & ADMIN SELECTOR BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between">
        <div className="w-full lg:w-80 relative">
          <input
            type="text"
            placeholder="Search action type..."
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

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Admin Officer Dropdown Filter */}
          <select
            value={selectedAdminEmail}
            onChange={(e) => { setSelectedAdminEmail(e.target.value); setPage(0); }}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">All Admin Officers</option>
            {adminsList.map((adm) => (
              <option key={adm.email} value={adm.email}>
                {adm.full_name}
              </option>
            ))}
          </select>

          {/* Module Filter Buttons */}
          {['ALL', 'EVENTS', 'ATTENDANCE', 'STUDENTS', 'REPORTS', 'ADMINS', 'FINES'].map((mod) => (
            <button
              key={mod}
              onClick={() => { setModuleFilter(mod); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                moduleFilter === mod
                  ? 'bg-[#8b0000] text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 border border-slate-200/80 hover:text-slate-900'
              }`}
            >
              {mod}
            </button>
          ))}
        </div>
      </div>

      {/* 3. TWO-PANE LOG VIEWER WITH PAGINATION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT PANE: ACTION STREAM */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          {/* Pagination Bar */}
          <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50/50">
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
                disabled={logs.length < pageSize}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer shadow-sm"
              >
                Next
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
              Streaming system logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
              No audit logs from the last 3 days matching this filter.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {logs.map((log) => {
                const isSelected = selectedLog?.id === log.id;

                return (
                  <button
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className={`w-full p-4 flex items-center justify-between text-left transition cursor-pointer ${
                      isSelected ? 'bg-red-50/70 border-l-4 border-l-[#8b0000]' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center font-black text-xs text-slate-700">
                        {log.actor_name?.charAt(0) || 'A'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{log.actor_name}</p>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${getModuleBadge(log.module)}`}>
                            {log.module}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono font-bold text-[#8b0000] mt-0.5">{log.action_type}</p>
                        <p className="text-[10px] text-slate-400 truncate">{log.actor_email}</p>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 ml-3">
                      <span className="text-[10px] font-mono font-semibold text-slate-500 block">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">
                        {new Date(log.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT PANE: AUDIT LOG INSPECTOR */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5 sticky top-6">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">
              Action Detail Inspector
            </h3>
            <span className="text-[10px] font-mono font-bold text-slate-400">
              {selectedLog ? `ID: ${selectedLog.id.slice(0, 8)}...` : 'No Selection'}
            </span>
          </div>

          {!selectedLog ? (
            <div className="py-12 text-center text-slate-400 text-xs font-semibold">
              Select an activity from the feed to view its execution payload.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Actor Info Box */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Executed By</p>
                <p className="font-bold text-slate-900 text-sm">{selectedLog.actor_name}</p>
                <p className="font-mono text-[11px] text-[#8b0000]">{selectedLog.actor_email}</p>
              </div>

              {/* Action Metadata Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Module</p>
                  <p className="font-black text-slate-800 mt-0.5">{selectedLog.module}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Action Type</p>
                  <p className="font-mono font-bold text-slate-800 mt-0.5 truncate">{selectedLog.action_type}</p>
                </div>

                <div className="col-span-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Timestamp</p>
                  <p className="font-mono font-bold text-slate-800 mt-0.5">
                    {new Date(selectedLog.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Target ID if exists */}
              {selectedLog.target_id && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Target Entity ID</p>
                  <p className="font-mono font-bold text-slate-800 mt-0.5 break-all">{selectedLog.target_id}</p>
                </div>
              )}

              {/* JSON Metadata Payload */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Detailed Payload / Metadata
                </p>
                <pre className="p-3.5 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-56">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. PDF PREVIEW MODAL */}
      {pdfPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full h-[88vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 flex-shrink-0">
              <div className="flex items-center gap-3">
                <img src={fcoLogo} alt="FCO Logo" className="w-8 h-8 object-contain" />
                <div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    PDF Audit Logs Preview ({selectedAdminEmail === 'ALL' ? 'All Officers' : selectedAdminEmail})
                  </h3>
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Inspect formatted log table before downloading
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
import React, { useState, useEffect, useDeferredValue } from 'react';
import { Users, Download, Search, Filter } from 'lucide-react';
import { supabase } from '../services/supabase';

const PAGE_SIZE = 15;

export default function IIEEMasterlistTab() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedSection, setSelectedSection] = useState('ALL');
  
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    setPage(0);
    fetchIIEEStudentsPage(0, deferredQuery, selectedYear, selectedSection, true);
  }, [deferredQuery, selectedYear, selectedSection]);

  async function fetchIIEEStudentsPage(pageIndex = 0, query = '', year = 'ALL', section = 'ALL', reset = false) {
    try {
      setLoading(true);
      let dbQuery = supabase
        .from('profiles')
        .select('*')
        .or('course.ilike.%BSEE%,course.ilike.%ELECTRICAL%')
        .order('full_name', { ascending: true })
        .range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE - 1);

      if (query.trim()) {
        dbQuery = dbQuery.or(`full_name.ilike.%${query}%,student_id.ilike.%${query}%,course.ilike.%${query}%`);
      }

      if (year !== 'ALL') {
        dbQuery = dbQuery.eq('year_level', year);
      }

      if (section !== 'ALL') {
        dbQuery = dbQuery.ilike('section', section);
      }

      const { data, error } = await dbQuery;
      if (error) throw error;

      const newStudents = data || [];
      setHasMore(newStudents.length === PAGE_SIZE);
      setStudents(reset ? newStudents : [...students, ...newStudents]);
    } catch (err) {
      console.error('Error loading IIEE masterlist:', err);
    } finally {
      setLoading(false);
    }
  }

  // Helper for proper ordinal suffixes (1st, 2nd, 3rd, 4th, etc.)
  const formatYearLevel = (yr) => {
    if (!yr) return 'N/A';
    const num = parseInt(yr, 10);
    if (isNaN(num)) return `${yr} Year`;
    if (num === 1) return '1st Year';
    if (num === 2) return '2nd Year';
    if (num === 3) return '3rd Year';
    return `${num}th Year`;
  };

  const handleDownloadPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups for this website to generate the PDF preview.');
      return;
    }

    const filterDescription = `Year: ${selectedYear === 'ALL' ? 'All Years' : formatYearLevel(selectedYear)} | Section: ${selectedSection === 'ALL' ? 'All Sections' : selectedSection}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>IIEE Student Masterlist Roster</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 15mm;
            }
            body { 
              font-family: sans-serif; 
              padding: 0; 
              margin: 0; 
              color: #0f172a; 
              background: #ffffff;
            }
            .header { 
              display: flex; 
              align-items: center; 
              gap: 16px; 
              border-bottom: 3px solid #854d0e; 
              padding-bottom: 14px; 
              margin-bottom: 16px; 
            }
            .logo { 
              width: 56px; 
              height: 56px; 
              border-radius: 50%; 
              object-fit: cover; 
              border: 2px solid #854d0e; 
            }
            .title-block h1 { 
              font-size: 18px; 
              font-weight: 900; 
              margin: 0; 
              text-transform: uppercase; 
              color: #854d0e; 
            }
            .title-block p { 
              font-size: 11px; 
              color: #64748b; 
              margin: 3px 0 0 0; 
            }
            .meta { 
              font-size: 11px; 
              color: #475569; 
              margin-bottom: 16px; 
              font-weight: 700; 
              display: flex; 
              justify-content: space-between; 
              background: #fefde8; 
              padding: 8px 12px; 
              border-radius: 6px; 
              border: 1px solid #fde047; 
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              font-size: 11px; 
              text-align: left; 
            }
            th { 
              background-color: #f8fafc; 
              color: #475569; 
              border-bottom: 2px solid #cbd5e1; 
              padding: 8px 10px; 
              text-transform: uppercase; 
              font-size: 10px; 
            }
            td { 
              border-bottom: 1px solid #e2e8f0; 
              padding: 8px 10px; 
              color: #1e293b; 
            }
            tr:nth-child(even) { 
              background-color: #fcfcfc; 
            }
            .footer { 
              margin-top: 24px; 
              text-align: right; 
              font-size: 10px; 
              color: #94a3b8; 
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="/IIEE-BG.png" alt="IIEE Logo" class="logo" onerror="this.style.display='none'" />
            <div class="title-block">
              <h1>IIEE - ESSU Student Chapter Masterlist</h1>
              <p>Official Electrical Engineering Students Enrolled</p>
            </div>
          </div>

          <div class="meta">
            <span><strong>Filter Applied:</strong> ${filterDescription}</span>
            <span><strong>Total Loaded Records:</strong> ${students.length}</span>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 40px;">No.</th>
                <th>Student Profile Name</th>
                <th>Student Number</th>
                <th>Program</th>
                <th>Year & Section</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((s, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td><strong>${s.full_name || 'N/A'}</strong></td>
                  <td><code>${s.student_id || 'N/A'}</code></td>
                  <td>${s.course || 'Electrical Engineering'}</td>
                  <td>${s.year_level ? `${s.year_level}${s.section || ''}` : 'N/A'}</td>
                </tr>
              `).join('')}
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
    <div>
      {/* Top Header & Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '900', textTransform: 'uppercase', margin: 0 }}>Student Accounts Masterlist</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Electrical Engineering department registry and enrolled student profiles.</p>
        </div>

        <button 
          onClick={handleDownloadPDF}
          style={{ 
            backgroundColor: '#854d0e', 
            color: '#ffffff', 
            border: 'none', 
            padding: '10px 16px', 
            borderRadius: '10px', 
            fontWeight: '800', 
            fontSize: '12px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            cursor: 'pointer',
            textTransform: 'uppercase',
            boxShadow: '0 2px 4px rgba(133, 77, 14, 0.2)'
          }}
        >
          <Download size={16} /> Download PDF Roster
        </button>
      </div>

      {/* Metric Summary Card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', background: '#fefde8', borderRadius: '12px', color: '#854d0e', border: '1px solid #fde047' }}>
            <Users size={24} />
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a' }}>
              {students.length} <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Students</span>
            </div>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Registry Records</div>
          </div>
        </div>
      </div>

      {/* Search & Dropdown Filters Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
            <Search size={16} />
          </span>
          <input 
            type="text"
            placeholder="Search by name, ID number, or program..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '11px 14px 11px 40px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
              outline: 'none'
            }}
          />
        </div>

        {/* Year Level Dropdown with proper ordinal suffix */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#ffffff', padding: '0 12px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
          <Filter size={14} color="#64748b" />
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Year:</span>
          <select 
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            style={{ padding: '10px 4px', border: 'none', fontSize: '13px', fontWeight: '700', color: '#0f172a', backgroundColor: 'transparent', outline: 'none', cursor: 'pointer' }}
          >
            <option value="ALL">All Years</option>
            <option value="1">1st Year</option>
            <option value="2">2nd Year</option>
            <option value="3">3rd Year</option>
            <option value="4">4th Year</option>
          </select>
        </div>

        {/* Section Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#ffffff', padding: '0 12px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
          <Filter size={14} color="#64748b" />
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Section:</span>
          <select 
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            style={{ padding: '10px 4px', border: 'none', fontSize: '13px', fontWeight: '700', color: '#0f172a', backgroundColor: 'transparent', outline: 'none', cursor: 'pointer' }}
          >
            <option value="ALL">All Sections</option>
            <option value="A">Section A</option>
            <option value="B">Section B</option>
            <option value="C">Section C</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={{ padding: '14px 20px' }}>Student Profile</th>
              <th style={{ padding: '14px 16px' }}>Student Number</th>
              <th style={{ padding: '14px 16px' }}>Program</th>
              <th style={{ padding: '14px 16px' }}>Year & Section</th>
            </tr>
          </thead>
          <tbody>
            {loading && students.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontWeight: '600' }}>
                  Loading IIEE student records...
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontWeight: '600' }}>
                  No student records found matching your filter criteria.
                </td>
              </tr>
            ) : (
              students.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: '#0f172a' }}>
                    {s.full_name || 'Unnamed Student'}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#475569', fontFamily: 'monospace', fontWeight: '600' }}>
                    {s.student_id || 'N/A'}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#854d0e', fontWeight: '700' }}>
                    {s.course || 'Electrical Engineering'}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '600' }}>
                    {s.year_level ? `${formatYearLevel(s.year_level).replace(' Year', '')} ${s.section || ''}` : 'N/A'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Load More Pagination Trigger */}
        {hasMore && !loading && (
          <div style={{ padding: '16px', textAlign: 'center', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                fetchIIEEStudentsPage(nextPage, deferredQuery, selectedYear, selectedSection, false);
              }}
              style={{ backgroundColor: '#854d0e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer', textTransform: 'uppercase' }}
            >
              Load More Students
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
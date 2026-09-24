import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase'; // Main FCO database for student profiles
import { piceClient, PICE_ORG_ID } from '../services/piceClient'; // Secondary PICE database client
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

export default function StudentSummaryTab({ currentUser }) {
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('1st Semester');
  const [summaryData, setSummaryData] = useState({ events: [], attendanceMap: {}, fines: [] });
  const [loading, setLoading] = useState(false);

  // Pagination for Student List (10 per page for lightning-fast responsiveness)
  const [studentPage, setStudentPage] = useState(1);
  const STUDENTS_PAGE_SIZE = 10;

  useEffect(() => {
    fetchPICEStudentsList();
  }, []);

  useEffect(() => {
    if (selectedStudent) {
      fetchStudentDetails(selectedStudent.id);
    }
  }, [selectedStudent, semesterFilter]);

  const fetchPICEStudentsList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, student_id, course, year_level, section, avatar_url, email')
        .or('course.ilike.%BSCE%,course.ilike.%CIVIL%')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setStudents(data || []);
      if (data && data.length > 0) {
        setSelectedStudent(data[0]);
      } else {
        setSelectedStudent(null);
      }
    } catch (err) {
      console.error('Error fetching PICE students:', err);
    }
  };

  const fetchStudentDetails = async (studentId) => {
    try {
      setLoading(true);

      // 🚀 Optimized Parallel Fetching via piceClient
      const [eventsRes, attRes, finesRes] = await Promise.all([
        piceClient
          .from('pice_events')
          .select('*')
          .eq('organization_id', PICE_ORG_ID)
          .order('start_time', { ascending: false }),
        piceClient
          .from('pice_attendance')
          .select('*')
          .eq('student_id', studentId),
        piceClient
          .from('pice_fines')
          .select('*')
          .eq('student_id', studentId)
          .eq('organization_id', PICE_ORG_ID)
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (attRes.error) throw attRes.error;
      if (finesRes.error) throw finesRes.error;

      const filteredEvents = (eventsRes.data || []).filter(evt => {
        if (semesterFilter === 'ALL') return true;
        const sem = evt.semester || '1st Semester';
        return sem.toLowerCase() === semesterFilter.toLowerCase();
      });

      const attendanceMap = {};
      (attRes.data || []).forEach((att) => {
        attendanceMap[att.event_id] = att;
      });

      setSummaryData({
        events: filteredEvents,
        attendanceMap,
        fines: finesRes.data || [],
      });
    } catch (err) {
      console.error('Error loading PICE student summary:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filtered Students and Slicing for Pagination
  const filteredStudents = students.filter((s) => {
    const name = (s.full_name || '').toLowerCase();
    const sId = (s.student_id || '').toLowerCase();
    const q = searchQuery.toLowerCase();
    return name.includes(q) || sId.includes(q);
  });

  const totalStudentPages = Math.ceil(filteredStudents.length / STUDENTS_PAGE_SIZE) || 1;
  const paginatedStudents = filteredStudents.slice((studentPage - 1) * STUDENTS_PAGE_SIZE, studentPage * STUDENTS_PAGE_SIZE);

  const totalEvents = summaryData.events.length;
  const attendedCount = summaryData.events.filter((evt) => {
    const att = summaryData.attendanceMap[evt.id];
    return !!(att?.time_in || att?.time_out);
  }).length;
  const absentCount = Math.max(0, totalEvents - attendedCount);
  
  // 🚀 Robust Fine Calculation (ini-handle din ang null/empty statuses)
  const totalUnpaidFines = (summaryData.fines || []).reduce((acc, curr) => {
    const amt = parseFloat(curr.amount) || 0;
    const st = String(curr.status || '').toLowerCase();
    
    if (!curr.status || st === '' || st === 'unpaid' || st === 'pending_approval' || st === 'pending') {
      return acc + amt;
    }
    return acc;
  }, 0);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* Top Header Card */}
      <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', margin: 0 }}>PICE Student Summary & Attendance Report</h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', margin: '4px 0 0 0' }}>
            Inspect individual BSCE event attendance history, absences, and financial compliance.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Semester:</span>
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: '700', color: '#334155', background: '#f8fafc', cursor: 'pointer', outline: 'none' }}
          >
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
            <option value="ALL">All Semesters</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px', alignItems: 'start' }}>
        {/* Left List with Pagination */}
        <div style={{ gridColumn: 'span 4 / span 4', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', height: '700px', overflow: 'hidden' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc', position: 'relative' }}>
            <input
              type="text"
              placeholder="Search BSCE student name or ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setStudentPage(1); }}
              style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', outline: 'none' }}
            />
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '26px', top: '50%', transform: 'translateY(-50%)' }} />
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {paginatedStudents.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>No BSCE students found</div>
            ) : (
              paginatedStudents.map((stu) => {
                const isSelected = selectedStudent?.id === stu.id;
                return (
                  <button
                    key={stu.id}
                    onClick={() => setSelectedStudent(stu)}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? '#fef3c7' : '#ffffff',
                      borderLeft: isSelected ? '4px solid #b45309' : '4px solid transparent'
                    }}
                  >
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#e2e8f0', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {stu.avatar_url ? (
                        <img src={stu.avatar_url} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontWeight: '900', fontSize: '12px', color: '#475569' }}>{stu.full_name?.charAt(0) || 'S'}</span>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stu.full_name}</p>
                      <p style={{ fontSize: '10px', fontFamily: 'monospace', color: '#64748b', margin: '2px 0 0 0' }}>{stu.student_id} • {stu.course}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Student List Pagination Bar */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <button
              onClick={() => setStudentPage(prev => Math.max(prev - 1, 1))}
              disabled={studentPage === 1}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: studentPage === 1 ? '#f1f5f9' : '#fff', color: studentPage === 1 ? '#94a3b8' : '#334155', fontSize: '11px', fontWeight: '700', cursor: studentPage === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
              Page {studentPage} of {totalStudentPages}
            </span>
            <button
              onClick={() => setStudentPage(prev => Math.min(prev + 1, totalStudentPages))}
              disabled={studentPage >= totalStudentPages}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: studentPage >= totalStudentPages ? '#f1f5f9' : '#fff', color: studentPage >= totalStudentPages ? '#94a3b8' : '#334155', fontSize: '11px', fontWeight: '700', cursor: studentPage >= totalStudentPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Right Details Panel */}
        <div style={{ gridColumn: 'span 8 / span 8', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {!selectedStudent ? (
            <div style={{ backgroundColor: '#ffffff', padding: '48px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>
              Select a BSCE student from the left list to inspect their record.
            </div>
          ) : (
            <>
              <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#e2e8f0', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #b45309' }}>
                    {selectedStudent.avatar_url ? (
                      <img src={selectedStudent.avatar_url} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontWeight: '900', fontSize: '18px', color: '#475569' }}>{selectedStudent.full_name?.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: '900', color: '#0f172a', margin: 0 }}>{selectedStudent.full_name}</h3>
                    <p style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: '800', color: '#b45309', margin: '2px 0' }}>{selectedStudent.student_id}</p>
                    <p style={{ fontSize: '11px', color: '#64748b', fontWeight: '500', margin: 0 }}>
                      {selectedStudent.course || 'BSCE'} • Year {selectedStudent.year_level || '1'} - Section {selectedStudent.section || 'A'}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Attended ({semesterFilter})</p>
                  <p style={{ fontSize: '22px', fontWeight: '900', color: '#059669', margin: '6px 0 0 0' }}>{attendedCount} / {totalEvents}</p>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Absent / Unexcused</p>
                  <p style={{ fontSize: '22px', fontWeight: '900', color: '#dc2626', margin: '6px 0 0 0' }}>{absentCount}</p>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Outstanding Fines</p>
                  <p style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', margin: '6px 0 0 0' }}>₱{totalUnpaidFines.toFixed(2)}</p>
                </div>
              </div>

              <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                  <h4 style={{ fontSize: '11px', fontWeight: '900', color: '#0f172a', textTransform: 'uppercase', margin: 0 }}>PICE Event Participation Breakdown ({semesterFilter})</h4>
                </div>

                {loading ? (
                  <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Loading student history...</div>
                ) : summaryData.events.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>No PICE events found for {semesterFilter}.</div>
                ) : (
                  <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>
                          <th style={{ padding: '12px 20px' }}>Event Title</th>
                          <th style={{ padding: '12px 20px' }}>Schedule</th>
                          <th style={{ padding: '12px 20px' }}>Status</th>
                          <th style={{ padding: '12px 20px', textAlign: 'right' }}>Time Logged</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: '11px', fontWeight: '600', color: '#334155' }}>
                        {summaryData.events.map((evt) => {
                          const att = summaryData.attendanceMap[evt.id];
                          const hasAttended = !!(att?.time_in || att?.time_out);

                          return (
                            <tr key={evt.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '14px 20px', fontWeight: '700', color: '#0f172a' }}>{evt.title}</td>
                              <td style={{ padding: '14px 20px', color: '#64748b' }}>
                                {new Date(evt.start_time).toLocaleDateString()} •{' '}
                                {new Date(evt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td style={{ padding: '14px 20px' }}>
                                {hasAttended ? (
                                  <span style={{ padding: '3px 8px', backgroundColor: '#ecfdf5', color: '#059669', fontWeight: '900', fontSize: '10px', textTransform: 'uppercase', borderRadius: '6px', border: '1px solid #a7f3d0' }}>
                                    ✓ Present
                                  </span>
                                ) : (
                                  <span style={{ padding: '3px 8px', backgroundColor: '#fef2f2', color: '#dc2626', fontWeight: '900', fontSize: '10px', textTransform: 'uppercase', borderRadius: '6px', border: '1px solid #fecaca' }}>
                                    ✕ Absent
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '14px 20px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b' }}>
                                {hasAttended
                                  ? new Date(att.time_in || att.time_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                  : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
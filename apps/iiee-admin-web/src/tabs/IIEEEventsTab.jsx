import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, IIEE_ORG_ID } from '../services/supabase';
import { attendanceClient } from '../lib/attendanceClient';
import { QrCode, PlusCircle, Search, Calendar, MapPin, Clock, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function IIEEEventsTab() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [activeQrEvent, setActiveQrEvent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [currentTime, setCurrentTime] = useState(new Date());

  // Secure deletion modal states
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const printRef = useRef(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [fineAmount, setFineAmount] = useState('50.00');
  const [requiresTimeOut, setRequiresTimeOut] = useState(false);
  const [semester, setSemester] = useState('1st Semester');
  
  // Geofencing states
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [allowedRadius, setAllowedRadius] = useState('20');

  useEffect(() => {
    fetchEvents();

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3500);
  };

const fetchEvents = async () => {
    try {
      setLoading(true);
      // 1. Fetch IIEE Events from secondary DB
      const { data: eventsData, error } = await attendanceClient
        .from('iiee_events')
        .select('*')
        .eq('organization_id', IIEE_ORG_ID)
        .order('start_time', { ascending: false });

      if (error) throw error;
      setEvents(eventsData || []);

      // 2. Client-side automated fine generation for expired/past events
      if (eventsData && eventsData.length > 0) {
        // Fetch all student profiles from main FCO database
        const { data: studentsData } = await supabase
          .from('profiles')
          .select('id, course');

        // Filter students belonging to IIEE (BSEE / Electrical)
        const iieeStudents = (studentsData || []).filter(s => {
          const c = (s.course || '').toUpperCase();
          return c.includes('BSEE') || c.includes('ELECTRICAL');
        });

        for (const evt of eventsData) {
          const now = new Date().getTime();
          const end = new Date(evt.end_time).getTime();

          // Check if event has ended or was created in the past
          if (now > end) {
            // Fetch existing attendance for this event
            const { data: attData } = await attendanceClient
              .from('iiee_attendance')
              .select('student_id')
              .eq('event_id', evt.id);

            const attendedStudentIds = new Set((attData || []).map(a => a.student_id));

            // Fetch existing fines for this event
            const { data: finesData } = await attendanceClient
              .from('iiee_fines')
              .select('student_id')
              .eq('event_id', evt.id);

            const finedStudentIds = new Set((finesData || []).map(f => f.student_id));

            // Identify absentees who don't have a fine yet
            for (const student of iieeStudents) {
              if (!attendedStudentIds.has(student.id) && !finedStudentIds.has(student.id)) {
                // Insert absence fine into secondary database
                await attendanceClient
                  .from('iiee_fines')
                  .insert([{
                    event_id: evt.id,
                    student_id: student.id,
                    amount: evt.fine_amount || 50.00,
                    status: 'unpaid',
                    remarks: 'Member (Auto-Generated)'
                  }]);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching IIEE events or generating fines:', err);
      showToast('Failed to load IIEE events.', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  const getEventAccessStatus = (event) => {
    const now = currentTime.getTime();
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();

    if (now >= start && now <= end) {
      return { isOpen: true, label: 'OPEN (ACTIVE)' };
    } else if (now < start) {
      return { isOpen: false, label: 'UPCOMING' };
    } else {
      return { isOpen: false, label: 'CLOSED (EXPIRED)' };
    }
  };

  const totalEvents = events.length;
  const openCount = events.filter((e) => getEventAccessStatus(e).isOpen).length;
  const closedCount = events.filter((e) => !getEventAccessStatus(e).isOpen).length;

  const handleOpenCreateModal = () => {
    setIsEditing(false);
    setSelectedEventId(null);
    setTitle('');
    setDescription('');
    setLocation('');
    setStartTime('');
    setEndTime('');
    setFineAmount('50.00');
    setRequiresTimeOut(false);
    setLatitude('');
    setLongitude('');
    setAllowedRadius('20');
    setSemester('1st Semester');
    setModalOpen(true);
  };

  const handleOpenEditModal = (event) => {
    setIsEditing(true);
    setSelectedEventId(event.id);
    setTitle(event.title || '');
    setDescription(event.description || '');
    setLocation(event.location || '');
    setStartTime(event.start_time ? new Date(event.start_time).toISOString().slice(0, 16) : '');
    setEndTime(event.end_time ? new Date(event.end_time).toISOString().slice(0, 16) : '');
    setFineAmount(event.fine_amount?.toString() || '50.00');
    setRequiresTimeOut(!!event.requires_time_out);
    setLatitude(event.latitude ? event.latitude.toString() : '');
    setLongitude(event.longitude ? event.longitude.toString() : '');
    setAllowedRadius(event.allowed_radius ? event.allowed_radius.toString() : '20');
    setSemester(event.semester || '1st Semester');
    setModalOpen(true);
  };

  const handleOpenQrModal = (event) => {
    setActiveQrEvent(event);
    setQrModalOpen(true);
  };

  const handlePrintQr = () => {
    window.print();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !startTime || !endTime) {
      showToast('Please provide event title, start time, and end time.', 'error');
      return;
    }

    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      showToast('End time must be after the start time.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        semester: semester,
        fine_amount: parseFloat(fineAmount) || 0.0,
        requires_time_out: requiresTimeOut,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        allowed_radius: parseInt(allowedRadius, 10) || 20,
        organization_id: IIEE_ORG_ID,
        status: 'upcoming',
        updated_at: new Date().toISOString(),
      };

      if (isEditing) {
        const { error } = await attendanceClient
          .from('iiee_events')
          .update(payload)
          .eq('id', selectedEventId)
          .eq('organization_id', IIEE_ORG_ID);

        if (error) throw error;
        showToast(`IIEE Event "${title}" updated successfully!`);
      } else {
        const { error } = await attendanceClient
          .from('iiee_events')
          .insert([payload]);

        if (error) throw error;
        showToast(`IIEE Event "${title}" created successfully!`);
      }

      setModalOpen(false);
      fetchEvents();
    } catch (err) {
      showToast(err.message || 'Operation failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // 🛡️ Integrity Check: Block deletion if attendance logs or fines exist
  const initiateDelete = async (event) => {
    try {
      showToast('Checking event records...', 'success');

      const { count: attendanceCount, error: attErr } = await attendanceClient
        .from('iiee_attendance')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      if (attErr) throw attErr;

      const { count: finesCount, error: finesErr } = await attendanceClient
        .from('iiee_fines')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      if (finesErr) throw finesErr;

      if ((attendanceCount || 0) > 0 || (finesCount || 0) > 0) {
        showToast(`Cannot delete event. It contains ${attendanceCount || 0} attendance log(s) and ${finesCount || 0} fine record(s).`, 'error');
        return;
      }

      setEventToDelete(event);
      setDeleteConfirmationText('');
      setDeleteModalOpen(true);
    } catch (err) {
      showToast(err.message || 'Error validating event dependencies.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!eventToDelete || deleteConfirmationText !== eventToDelete.title) {
      showToast('Typed title does not match.', 'error');
      return;
    }

    setDeleting(true);
    try {
      const { error } = await attendanceClient
        .from('iiee_events')
        .delete()
        .eq('id', eventToDelete.id)
        .eq('organization_id', IIEE_ORG_ID);

      if (error) throw error;

      showToast(`Event "${eventToDelete.title}" deleted successfully.`);
      setDeleteModalOpen(false);
      setEventToDelete(null);
      fetchEvents();
    } catch (err) {
      showToast(err.message || 'Deletion failed.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filteredEvents = events.filter((e) => {
    const access = getEventAccessStatus(e);
    const matchesSearch =
      (e.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.location || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'OPEN' && access.isOpen) ||
      (statusFilter === 'CLOSED' && !access.isOpen);

    const matchesSemester = semesterFilter === 'ALL' || e.semester === semesterFilter;

    return matchesSearch && matchesStatus && matchesSemester;
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
            <span>{toast.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* 1. TOP STAT CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total IIEE Assemblies</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#0f172a', marginTop: '6px' }}>{totalEvents}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500', marginTop: '4px' }}>BSEE Chapter Ledger</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Currently OPEN</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#16a34a', marginTop: '6px' }}>{openCount}</div>
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '500', marginTop: '4px' }}>Accepting BSEE Check-Ins</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CLOSED</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#64748b', marginTop: '6px' }}>{closedCount}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500', marginTop: '4px' }}>Scanning Locked</div>
        </div>
      </div>

      {/* 2. ACTION BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>IIEE Events & Attendance Management</h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '400' }}>
            Publish BSEE chapter assemblies, fines, and geofenced QR codes independent of FCO and PICE.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          style={{ backgroundColor: '#854d0e', color: '#ffffff', padding: '10px 18px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(133, 77, 14, 0.15)' }}
        >
          <PlusCircle size={15} />
          <span>Create IIEE Event</span>
        </button>
      </div>

      {/* 3. FILTER AND SEARCH BAR */}
      <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
          <input
            type="text"
            placeholder="Search by event title or location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none', fontWeight: '400' }}
          />
          <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '600', color: '#334155', background: '#f8fafc', cursor: 'pointer', textTransform: 'uppercase' }}
          >
            <option value="ALL">Semester: All</option>
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
          </select>

          <div style={{ display: 'flex', background: '#f8fafc', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            {['ALL', 'OPEN', 'CLOSED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: statusFilter === st ? '#854d0e' : 'transparent',
                  color: statusFilter === st ? '#ffffff' : '#64748b',
                  transition: 'background 0.2s'
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. EVENTS MASTERLIST TABLE */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase' }}>
            Loading IIEE events...
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px' }}>
                  <th style={{ padding: '14px 16px' }}>Event & Venue</th>
                  <th style={{ padding: '14px 16px' }}>Schedule Window</th>
                  <th style={{ padding: '14px 16px' }}>Absence Fine</th>
                  <th style={{ padding: '14px 16px' }}>Live Status</th>
                  <th style={{ padding: '14px 16px' }}>QR Stand</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>
                      No IIEE events found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((evt) => {
                    const start = new Date(evt.start_time);
                    const end = new Date(evt.end_time);
                    const access = getEventAccessStatus(evt);

                    return (
                      <tr key={evt.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <p style={{ fontWeight: '600', color: '#0f172a', margin: '0 0 2px 0', fontSize: '13px' }}>{evt.title}</p>
                          <p style={{ fontSize: '11px', color: '#64748b', margin: 0, fontWeight: '400' }}>📍 {evt.location || 'ESSU Campus'} {evt.allowed_radius ? `(${evt.allowed_radius}m radius)` : ''}</p>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <p style={{ fontWeight: '600', color: '#334155', margin: '0 0 2px 0', fontSize: '12px' }}>
                            {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                          <p style={{ fontSize: '11px', color: '#64748b', margin: 0, fontWeight: '400' }}>
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </td>
                        <td style={{ padding: '14px 16px', fontWeight: '600', color: '#b91c1c', fontSize: '13px' }}>
                          ₱{evt.fine_amount}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '20px',
                            fontSize: '10px',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            backgroundColor: access.isOpen ? '#ecfdf5' : '#f1f5f9',
                            color: access.isOpen ? '#065f46' : '#475569',
                            border: `1px solid ${access.isOpen ? '#a7f3d0' : '#cbd5e1'}`
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: access.isOpen ? '#10b981' : '#94a3b8' }} />
                            {access.isOpen ? 'OPEN' : 'CLOSED'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <button
                            onClick={() => handleOpenQrModal(evt)}
                            style={{ backgroundColor: '#fefde8', color: '#854d0e', border: '1px solid #fde047', padding: '6px 12px', borderRadius: '8px', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                          >
                            <QrCode size={13} />
                            <span>QR Stand</span>
                          </button>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleOpenEditModal(evt)}
                            style={{ backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '6px 12px', borderRadius: '8px', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer', marginRight: '6px' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => initiateDelete(evt)}
                            style={{ backgroundColor: 'transparent', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '8px', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
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

      {/* 5. SECURE DELETE CONFIRMATION MODAL */}
      {deleteModalOpen && eventToDelete && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '400px', width: '100%', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
              <ShieldAlert size={22} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', textAlign: 'center', margin: '0 0 8px 0', textTransform: 'uppercase' }}>Confirm Event Deletion</h3>
            <p style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', margin: '0 0 16px 0', lineHeight: '1.4', fontWeight: '400' }}>
              To prevent accidental record loss, please type the exact title of the event:
            </p>
            <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', fontWeight: '600', color: '#0f172a', textAlign: 'center', marginBottom: '16px' }}>
              {eventToDelete.title}
            </div>
            <input
              type="text"
              placeholder="Type exact event title..."
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', marginBottom: '20px', outline: 'none', fontWeight: '400' }}
            />
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirmationText !== eventToDelete.title}
                onClick={handleConfirmDelete}
                style={{ flex: 1, backgroundColor: '#dc2626', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', opacity: deleting || deleteConfirmationText !== eventToDelete.title ? 0.4 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. QR CODE PREVIEW & PRINT MODAL */}
      {qrModalOpen && activeQrEvent && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', maxWidth: '420px', width: '100%', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>IIEE Event QR Stand</h3>
              <button onClick={() => setQrModalOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '18px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>

            <div ref={printRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <img 
                  src="/IIEE-BG.png" 
                  alt="IIEE Logo" 
                  style={{ width: '38px', height: '38px', borderRadius: '50%', border: '2px solid #854d0e', objectFit: 'cover', flexShrink: 0 }} 
                />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#854d0e' }}>IIEE ESSU CHAPTER</div>
                  <div style={{ fontSize: '9px', fontWeight: '600', color: '#64748b' }}>ATENDER SUB-ORG CONSOLE</div>
                </div>
              </div>

              <h4 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px 0' }}>{activeQrEvent.title}</h4>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 20px 0', fontWeight: '400' }}>📍 {activeQrEvent.location || 'ESSU Campus'}</p>

              <div style={{ padding: '16px', backgroundColor: '#ffffff', borderRadius: '16px', border: '2px dashed #854d0e', marginBottom: '20px' }}>
                <QRCodeSVG
                  value={JSON.stringify({
                    eventId: activeQrEvent.id,
                    title: activeQrEvent.title,
                    organizationId: IIEE_ORG_ID,
                    type: 'IIEE_EVENT_ATTENDANCE',
                  })}
                  size={190}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div style={{ width: '100%', background: '#f8fafc', padding: '10px', borderRadius: '10px', fontSize: '11px', color: '#64748b', fontWeight: '500', marginBottom: '20px' }}>
                Scan using the Atender Student App during the active time window.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setQrModalOpen(false)}
                style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                Close
              </button>
              <button
                onClick={handlePrintQr}
                style={{ flex: 1, backgroundColor: '#854d0e', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                Print Stand
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. CREATE / EDIT MODAL */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', maxWidth: '520px', width: '100%', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', color: '#0f172a', margin: 0, letterSpacing: '0.5px' }}>
                  {isEditing ? 'Update IIEE Event' : 'Create IIEE Event'}
                </h3>
                <p style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontWeight: '400' }}>Scoped strictly to IIEE BSEE organization ledger.</p>
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '18px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Academic Semester</label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#f8fafc', fontWeight: '500' }}
                >
                  <option value="1st Semester">1st Semester</option>
                  <option value="2nd Semester">2nd Semester</option>
                  <option value="Summer Term">Summer Term</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Event Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., IIEE Electrical Engineering Seminar"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', fontWeight: '400', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Venue / Location</label>
                <input
                  type="text"
                  placeholder="e.g., ESSU Electrical Lab"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', fontWeight: '400', outline: 'none' }}
                />
              </div>

              {/* Geofencing Configuration */}
              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Geofencing & GPS</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setLatitude(pos.coords.latitude.toString());
                            setLongitude(pos.coords.longitude.toString());
                            showToast('GPS coordinates captured!');
                          },
                          () => showToast('Could not retrieve location.', 'error'),
                          { enableHighAccuracy: true }
                        );
                      }
                    }}
                    style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '6px 10px', borderRadius: '8px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    📍 Auto-Detect GPS
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input type="text" placeholder="Latitude" value={latitude} onChange={(e) => setLatitude(e.target.value)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '400', outline: 'none' }} />
                  <input type="text" placeholder="Longitude" value={longitude} onChange={(e) => setLongitude(e.target.value)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '400', outline: 'none' }} />
                </div>
                <input type="number" placeholder="Allowed Radius (Meters)" value={allowedRadius} onChange={(e) => setAllowedRadius(e.target.value)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', width: '100%', boxSizing: 'border-box', fontWeight: '400', outline: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Start Time</label>
                  <input type="datetime-local" required value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', fontWeight: '400' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>End Time</label>
                  <input type="datetime-local" required value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '12px', boxSizing: 'border-box', fontWeight: '400' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Absence Fine (₱)</label>
                <input type="number" step="0.01" required value={fineAmount} onChange={(e) => setFineAmount(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', fontWeight: '400', outline: 'none' }} />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Description</label>
                <textarea rows={2} placeholder="Event guidelines..." value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', fontWeight: '400', outline: 'none' }} />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#334155', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ flex: 1, backgroundColor: '#854d0e', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', opacity: submitting ? 0.5 : 1 }}>{submitting ? 'Saving...' : 'Save Event'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import fcoLogo from '../../assets/FCO-LOGOO.png';
import { logAdminAction } from '../../lib/auditLogger';

export default function EventsTab({ currentUser }) {
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
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [semester, setSemester] = useState('1st Semester');

  // Secure deletion modal states
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const printRef = useRef(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [fineAmount, setFineAmount] = useState('50.00');
  const [requiresTimeOut, setRequiresTimeOut] = useState(false);
  
  // Geofencing states
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [allowedRadius, setAllowedRadius] = useState('20');

  useEffect(() => {
    fetchEvents();

    // 1-second interval to keep time-based Open/Closed status real-time
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

      // --- LIGHTNING FAST OPTIMIZATION ---
      // Fetch events instantly so the table populates without delay
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('start_time', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Error fetching events:', err);
      showToast('Failed to load events.', 'error');
    } finally {
      setLoading(false);
    }

    // Run absence fine evaluation silently in the background (non-blocking)
    try {
      supabase.rpc('process_expired_event_fines').catch((syncErr) => {
        console.warn('Background auto-fine processing notice:', syncErr);
      });
    } catch (e) {
      // Ignored non-blocking
    }
  };

  // Pure schedule-based evaluation (Reopens automatically when edit extends end_time)
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

  // KPI Metrics
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
    setModalOpen(true);
    setSemester('1st Semester');
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
    setModalOpen(true);
    setSemester(event.semester || '1st Semester');
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
        status: 'upcoming',
        updated_at: new Date().toISOString(),
      };

      if (isEditing) {
        const { error } = await supabase
          .from('events')
          .update(payload)
          .eq('id', selectedEventId);

        if (error) throw error;

        // Log action for updating event
        await logAdminAction({
          currentUser,
          actionType: 'UPDATE_EVENT',
          module: 'EVENTS',
          targetId: selectedEventId,
          details: {
            title: payload.title,
            location: payload.location,
            start_time: payload.start_time,
            end_time: payload.end_time,
            fine_amount: payload.fine_amount,
            allowed_radius: payload.allowed_radius,
          },
        });

        showToast(`Event "${title}" updated successfully!`);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: createdData, error } = await supabase
          .from('events')
          .insert([{ ...payload, created_by: user?.id || null }])
          .select();

        if (error) throw error;

        // Log action for creating event
        await logAdminAction({
          currentUser,
          actionType: 'CREATE_EVENT',
          module: 'EVENTS',
          targetId: createdData?.[0]?.id || null,
          details: {
            title: payload.title,
            location: payload.location,
            start_time: payload.start_time,
            end_time: payload.end_time,
            fine_amount: payload.fine_amount,
            allowed_radius: payload.allowed_radius,
          },
        });

        showToast(`Event "${title}" created successfully!`);
      }

      setModalOpen(false);
      fetchEvents();
    } catch (err) {
      showToast(err.message || 'Operation failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Secure deletion check & trigger
  const initiateDelete = async (event) => {
    try {
      const { count: attendanceCount } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      const { count: finesCount } = await supabase
        .from('fines')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      if ((attendanceCount || 0) > 0 || (finesCount || 0) > 0) {
        showToast(
          `Protected: Event has ${attendanceCount || 0} attendance log(s) and ${finesCount || 0} fine(s). Cannot be deleted.`,
          'error'
        );
        return;
      }

      setEventToDelete(event);
      setDeleteConfirmationText('');
      setDeleteModalOpen(true);
    } catch (err) {
      showToast('Error validating event dependencies.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!eventToDelete || deleteConfirmationText !== eventToDelete.title) {
      showToast('Typed title does not match.', 'error');
      return;
    }

    setDeleting(true);
    try {
      const { error } = await supabase.from('events').delete().eq('id', eventToDelete.id);
      if (error) throw error;

      // Log action for deleting event
      await logAdminAction({
        currentUser,
        actionType: 'DELETE_EVENT',
        module: 'EVENTS',
        targetId: eventToDelete.id,
        details: {
          title: eventToDelete.title,
          location: eventToDelete.location,
          start_time: eventToDelete.start_time,
          end_time: eventToDelete.end_time,
        },
      });

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

  // Filter pipeline
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
    <div className="space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-6 right-6 z-[100] animate-bounce print:hidden">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border text-xs font-bold ${
              toast.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            <span>{toast.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* 1. TOP STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 print:hidden">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-base font-black text-slate-800">Total Assemblies</h3>
          <p className="text-3xl font-black text-slate-900 mt-2">{totalEvents}</p>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Configured Events</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-base font-black text-slate-800">Currently OPEN</h3>
          <p className="text-3xl font-black text-emerald-600 mt-2">{openCount}</p>
          <p className="text-xs text-emerald-600 font-semibold mt-0.5">Accepting Student Check-Ins</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-base font-black text-slate-800">CLOSED</h3>
          <p className="text-3xl font-black text-slate-500 mt-2">{closedCount}</p>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Scanning Locked</p>
        </div>
      </div>

      {/* 2. ACTION BAR */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm print:hidden">
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">FCO Calendar & Attendance Sessions</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Sessions automatically open & close based on scheduled times. Edit dates/hours anytime to reopen.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="px-5 py-3 bg-[#8b0000] hover:bg-[#700000] active:scale-[0.99] text-white font-bold text-xs uppercase tracking-widest rounded-xl transition shadow-md shadow-[#8b0000]/20 flex items-center gap-2 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Create Event</span>
        </button>
      </div>

      {/* 3. FILTER AND SEARCH BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between print:hidden">
        <div className="w-full lg:w-96 relative">
          <input
            type="text"
            placeholder="Search by event title or location..."
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
          {/* Semester Filter Dropdown */}
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">Semester: All</option>
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
          </select>

          {/* Status Pills */}
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/80">
            {['ALL', 'OPEN', 'CLOSED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition ${
                  statusFilter === st
                    ? 'bg-[#8b0000] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* 4. EVENTS MASTERLIST TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden print:hidden">
        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            Loading events...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Event & Venue</th>
                  <th className="px-6 py-4">Schedule Window</th>
                  <th className="px-6 py-4">Live Status</th>
                  <th className="px-6 py-4">QR Stand</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-xs">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                      No events found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((evt) => {
                    const start = new Date(evt.start_time);
                    const end = new Date(evt.end_time);
                    const access = getEventAccessStatus(evt);

                    return (
                      <tr key={evt.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-900 text-sm">{evt.title}</p>
                          <p className="text-slate-400 text-[11px] mt-0.5">📍 {evt.location || 'ESSU Campus'} {evt.allowed_radius ? `(${evt.allowed_radius}m radius)` : ''}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800">
                            {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                          <p className="text-slate-400 text-[11px] mt-0.5">
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              access.isOpen
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${access.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            {access.isOpen ? 'OPEN' : 'CLOSED'}
                          </span>
                          <p className="text-[10px] text-slate-400 mt-1 font-semibold">{access.label}</p>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleOpenQrModal(evt)}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-[#8b0000] border border-red-200/80 font-bold text-[11px] uppercase tracking-wider rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                            <span>QR Stand</span>
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right space-x-1.5">
                          <button
                            onClick={() => handleOpenEditModal(evt)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider rounded-lg transition cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => initiateDelete(evt)}
                            className="px-2.5 py-1.5 text-red-600 hover:text-red-800 font-bold uppercase text-[11px] rounded-lg transition hover:bg-red-50 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-red-100 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div className="text-center">
              <h3 className="text-base font-black text-slate-900 uppercase">Confirm Event Deletion</h3>
              <p className="text-xs text-slate-500 mt-1">
                To prevent accidental loss of records, please type the exact title of the event:
              </p>
              <div className="mt-2 p-2 bg-slate-100 rounded-lg text-xs font-mono font-bold text-slate-800 select-all">
                {eventToDelete.title}
              </div>
            </div>

            <input
              type="text"
              placeholder="Type exact event title..."
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirmationText !== eventToDelete.title}
                onClick={handleConfirmDelete}
                className="w-1/2 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. QR CODE PREVIEW & PRINT MODAL */}
      {qrModalOpen && activeQrEvent && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 print:hidden">
              <h3 className="font-black text-slate-800 uppercase tracking-wide text-xs">
                Event QR Stand
              </h3>
              <button
                onClick={() => setQrModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <div ref={printRef} className="py-6 flex flex-col items-center text-center">
              <div className="flex items-center gap-2 mb-4">
                <img src={fcoLogo} alt="FCO Logo" className="w-10 h-10 object-contain" />
                <div className="text-left">
                  <h4 className="text-xs font-black tracking-wider text-[#8b0000] leading-tight">
                    ATENDER ATTENDANCE
                  </h4>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                    College of Engineering • ESSU
                  </p>
                </div>
              </div>

              <h3 className="text-base font-black text-slate-900 uppercase tracking-tight max-w-[280px]">
                {activeQrEvent.title}
              </h3>
              <p className="text-xs font-semibold text-slate-500 mt-1">
                📍 {activeQrEvent.location || 'ESSU Campus Venue'}
              </p>

              <div className="my-5 p-4 bg-white rounded-2xl border-2 border-dashed border-[#8b0000]/40 shadow-inner flex items-center justify-center">
                <QRCodeSVG
                  value={JSON.stringify({
                    eventId: activeQrEvent.id,
                    title: activeQrEvent.title,
                    description: activeQrEvent.description || '',
                    type: 'FCO_EVENT_ATTENDANCE',
                  })}
                  size={210}
                  level="H"
                  includeMargin={true}
                />
              </div>

              {activeQrEvent.description && (
                <div className="w-full bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-left mb-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                    Event Guidelines / Details:
                  </p>
                  <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">
                    {activeQrEvent.description}
                  </p>
                </div>
              )}

              <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] text-slate-600 font-medium space-y-1">
                <p>
                  Schedule: {new Date(activeQrEvent.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to {new Date(activeQrEvent.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-[10px] text-slate-400">
                  Scan using the Atender Student App during the active time window.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-100 print:hidden">
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handlePrintQr}
                className="w-1/2 py-2.5 bg-[#8b0000] hover:bg-[#700000] text-white font-bold rounded-xl text-xs uppercase tracking-wider transition shadow-md shadow-[#8b0000]/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Print Stand</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. CREATE / EDIT MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-800 uppercase tracking-wide text-sm">
                  {isEditing ? 'Update Event Details' : 'Create New Event'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Set event timing, venue geofencing, and absence sanctions
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <div>
              <label className="block mb-1.5">Academic Semester</label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000] cursor-pointer"
              >
                <option value="1st Semester">1st Semester</option>
                <option value="2nd Semester">2nd Semester</option>
                <option value="Summer Term">Summer Term</option>
              </select>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mt-5 text-xs font-bold uppercase text-slate-700">
              <div>
                <label className="block mb-1.5">Event Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FCO General Assembly 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                />
              </div>

              <div>
                <label className="block mb-1.5">Venue / Location</label>
                <input
                  type="text"
                  placeholder="e.g. Teatro Ibabawnon / ESSU Sports Oval"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                />
              </div>

              {/* Geofencing & Venue GPS Configuration */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-700 uppercase">Geofencing & Venue GPS</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setLatitude(pos.coords.latitude.toString());
                            setLongitude(pos.coords.longitude.toString());
                            showToast('Current GPS coordinates captured successfully!');
                          },
                          (err) => showToast('Could not retrieve location. Ensure GPS is enabled.', 'error'),
                          { enableHighAccuracy: true }
                        );
                      } else {
                        showToast('Geolocation is not supported by your browser.', 'error');
                      }
                    }}
                    className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase transition cursor-pointer"
                  >
                    📍 Auto-Detect My GPS
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Latitude</label>
                    <input
                      type="text"
                      placeholder="e.g. 11.65971"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Longitude</label>
                    <input
                      type="text"
                      placeholder="e.g. 125.44236"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Allowed Distance Radius (Meters)</label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    placeholder="e.g. 20"
                    value={allowedRadius}
                    onChange={(e) => setAllowedRadius(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Enter the maximum distance in meters students are allowed to be from the venue.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5">Start Time (Auto-Opens)</label>
                  <input
                    type="datetime-local"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                  />
                </div>
                <div>
                  <label className="block mb-1.5">End Time (Auto-Closes)</label>
                  <input
                    type="datetime-local"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5">Absence Sanction (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={fineAmount}
                  onChange={(e) => setFineAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                />
              </div>

              <div>
                <label className="block mb-1.5">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Additional agenda or guidelines..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-[#8b0000] hover:bg-[#700000] disabled:opacity-50 text-white font-bold rounded-xl tracking-wider uppercase transition shadow-md shadow-[#8b0000]/20 cursor-pointer"
                >
                  {submitting
                    ? isEditing ? 'Updating...' : 'Creating...'
                    : isEditing ? 'Save Changes' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
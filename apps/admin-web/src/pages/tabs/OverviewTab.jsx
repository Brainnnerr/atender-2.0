import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [analytics, setAnalytics] = useState({
    totalEvents: 0,
    totalAttendance: 0,
    averageTurnoutRate: 0,
    departmentTurnout: { BSCE: 0, BSEE: 0, BSCpE: 0 },
    eventStats: [],
    turnoutTiming: { morning: 0, afternoon: 0, evening: 0 },
  });

  useEffect(() => {
    fetchAnalyticsData();
  }, [semesterFilter]);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);

      // 1. Fetch main FCO events with optional semester filter
      let eventsQuery = supabase
        .from('events')
        .select('*')
        .order('start_time', { ascending: false });

      if (semesterFilter !== 'ALL') {
        eventsQuery = eventsQuery.eq('semester', semesterFilter);
      }

      const { data: eventsData, error: evErr } = await eventsQuery;
      if (evErr) throw new Error(evErr.message || 'Failed to fetch events');

      const events = eventsData || [];
      const eventIds = events.map(e => e.id);

      // 2. Fetch all student profiles for total department headcount from main DB
      const { data: studentsData, error: stuErr } = await supabase
        .from('profiles')
        .select('id, course, role')
        .eq('role', 'student');
      
      if (stuErr) throw new Error(stuErr.message || 'Failed to fetch student profiles');

      const students = studentsData || [];
      const studentCourseMap = {};
      students.forEach(s => {
        studentCourseMap[s.id] = s.course || 'BSCpE';
      });

      // 3. Fetch main FCO attendance logs corresponding to active events
      let attendance = [];
      if (eventIds.length > 0) {
        const { data: attData, error: attErr } = await supabase
          .from('attendance')
          .select('id, event_id, time_in, student_id')
          .in('event_id', eventIds);
        
        if (attErr) throw new Error(attErr.message || 'Failed to fetch attendance records');
        
        attendance = (attData || []).map(att => ({
          ...att,
          profiles: { course: studentCourseMap[att.student_id] || 'BSCpE' }
        }));
      }

      // Calculate Department Headcounts
      const deptTotals = { BSCE: 0, BSEE: 0, BSCpE: 0 };
      students.forEach((s) => {
        const c = (s.course || '').toUpperCase();
        if (c.includes('CIVIL') || c === 'BSCE') deptTotals.BSCE += 1;
        else if (c.includes('ELECTRICAL') || c === 'BSEE') deptTotals.BSEE += 1;
        else if (c.includes('COMPUTER') || c === 'BSCpE') deptTotals.BSCpE += 1;
      });

      // Calculate Department Turnout Counts in Attendance
      const deptTurnout = { BSCE: 0, BSEE: 0, BSCpE: 0 };
      attendance.forEach((att) => {
        const c = (att.profiles?.course || '').toUpperCase();
        if (c.includes('CIVIL') || c === 'BSCE') deptTurnout.BSCE += 1;
        else if (c.includes('ELECTRICAL') || c === 'BSEE') deptTurnout.BSEE += 1;
        else if (c.includes('COMPUTER') || c === 'BSCpE') deptTurnout.BSCpE += 1;
      });

      // Calculate Turnout Rate per Department (%)
      const departmentTurnoutRates = {
        BSCE: deptTotals.BSCE > 0 ? Math.round((deptTurnout.BSCE / (deptTotals.BSCE * Math.max(1, events.length))) * 100) : 0,
        BSEE: deptTotals.BSEE > 0 ? Math.round((deptTurnout.BSEE / (deptTotals.BSEE * Math.max(1, events.length))) * 100) : 0,
        BSCpE: deptTotals.BSCpE > 0 ? Math.round((deptTurnout.BSCpE / (deptTotals.BSCpE * Math.max(1, events.length))) * 100) : 0,
      };

      // Calculate Time-of-Day Check-in Distribution
      const timing = { morning: 0, afternoon: 0, evening: 0 };
      attendance.forEach((att) => {
        const timestamp = att.time_in;
        if (timestamp) {
          const hour = new Date(timestamp).getHours();
          if (hour >= 6 && hour < 12) timing.morning += 1;
          else if (hour >= 12 && hour < 18) timing.afternoon += 1;
          else timing.evening += 1;
        }
      });

      // Build Per-Event Analytics Performance List
      const eventPerformanceMap = {};
      events.forEach((e) => {
        eventPerformanceMap[e.id] = {
          id: e.id,
          title: e.title,
          startTime: e.start_time,
          checkIns: 0,
        };
      });

      attendance.forEach((att) => {
        if (eventPerformanceMap[att.event_id]) {
          eventPerformanceMap[att.event_id].checkIns += 1;
        }
      });

      const eventStatsList = Object.values(eventPerformanceMap).sort((a, b) => b.checkIns - a.checkIns);

      // Overall average turnout rate
      const totalPossibleAttendance = students.length * events.length;
      const overallRate = totalPossibleAttendance > 0 ? Math.round((attendance.length / totalPossibleAttendance) * 100) : 0;

      setAnalytics({
        totalEvents: events.length,
        totalAttendance: attendance.length,
        averageTurnoutRate: overallRate,
        departmentTurnout: departmentTurnoutRates,
        eventStats: eventStatsList,
        turnoutTiming: timing,
      });
    } catch (err) {
      console.error('Error compiling analytics:', err.message || err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center space-y-3">
        <div className="w-10 h-10 border-4 border-[#8b0000]/20 border-t-[#8b0000] rounded-full animate-spin" />
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Analyzing Event Telemetry & Turnout Trends...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* 1. TOP HEADER CARD */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Event Analytics & Insights</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Comprehensive breakdown of student assembly turnout, department participation metrics, and check-in trends.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Semester Filter Dropdown */}
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase cursor-pointer"
          >
            <option value="ALL">Semester: All</option>
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer Term">Summer Term</option>
          </select>
          <button
            onClick={fetchAnalyticsData}
            className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* 2. ANALYTICAL METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Overall Turnout Rate</p>
            <p className="text-3xl font-black text-emerald-600 mt-2">{analytics.averageTurnoutRate}%</p>
            <span className="text-[11px] font-semibold text-emerald-600 mt-1 inline-block">Average attendance across events</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Events Hosted</p>
            <p className="text-3xl font-black text-blue-600 mt-2">{analytics.totalEvents}</p>
            <span className="text-[11px] font-semibold text-blue-500 mt-1 inline-block">Scheduled Assemblies</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Check-Ins Verified</p>
            <p className="text-3xl font-black text-slate-900 mt-2">{analytics.totalAttendance}</p>
            <span className="text-[11px] font-semibold text-slate-500 mt-1 inline-block">Cumulative student scans</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {/* 3. DEPARTMENT TURNOUT & PEAK TIMING BREAKDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Comparison Progress Bars */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Department Turnout Rates</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Comparative participation across engineering programs</p>
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                <span>Computer Engineering (BSCpE)</span>
                <span className="text-[#8b0000]">{analytics.departmentTurnout.BSCpE}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-[#8b0000] h-full rounded-full" style={{ width: `${Math.min(100, analytics.departmentTurnout.BSCpE)}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                <span>Civil Engineering (BSCE)</span>
                <span className="text-blue-600">{analytics.departmentTurnout.BSCE}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full" style={{ width: `${Math.min(100, analytics.departmentTurnout.BSCE)}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                <span>Electrical Engineering (BSEE)</span>
                <span className="text-emerald-600">{analytics.departmentTurnout.BSEE}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${Math.min(100, analytics.departmentTurnout.BSEE)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Peak Check-in Timing Distribution */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Peak Check-In Distribution</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Time periods when students arrive and scan QR codes</p>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 text-center">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Morning (6 AM - 12 PM)</p>
              <p className="text-2xl font-black text-slate-800 mt-2">{analytics.turnoutTiming.morning}</p>
              <span className="text-[10px] font-bold text-slate-500">Scans</span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Afternoon (12 PM - 6 PM)</p>
              <p className="text-2xl font-black text-slate-800 mt-2">{analytics.turnoutTiming.afternoon}</p>
              <span className="text-[10px] font-bold text-slate-500">Scans</span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Evening (6 PM Onwards)</p>
              <p className="text-2xl font-black text-slate-800 mt-2">{analytics.turnoutTiming.evening}</p>
              <span className="text-[10px] font-bold text-slate-500">Scans</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. EVENT PERFORMANCE LEADERBOARD TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Event Attendance Leaderboard</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Assemblies ranked by highest student participation</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{analytics.eventStats.length} Total Events</span>
        </div>

        {analytics.eventStats.length === 0 ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase">No events recorded for this selection.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Assembly / Event Title</th>
                  <th className="px-6 py-4">Scheduled Date</th>
                  <th className="px-6 py-4 text-right">Verified Check-Ins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-xs">
                {analytics.eventStats.map((evt, index) => (
                  <tr key={evt.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-[11px]">
                          {index + 1}
                        </span>
                        <span className="font-bold text-slate-900">{evt.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(evt.startTime).toLocaleDateString()} • {new Date(evt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-block px-3 py-1 bg-emerald-50 text-emerald-700 font-black text-xs rounded-md border border-emerald-200">
                        {evt.checkIns} Students
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
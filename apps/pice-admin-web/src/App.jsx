import React, { useState, useEffect } from 'react';
import { supabase } from './services/supabase'; // 👈 Fixed relative path for central FCO profiles
import { piceClient, PICE_ORG_ID } from './services/piceClient'; // 👈 Fixed path and imported PICE secondary client
import Sidebar from './components/Sidebar';
import OverviewTab from './components/OverviewTab';
import EventsTab from './components/EventsTab';
import MasterlistTab from './components/MasterlistTab';
import AttendanceTab from './components/AttendanceTab';
import FineManagementTab from './components/FineManagementTab';
import StudentSummaryTab from './components/StudentSummaryTab';
import ReportsTab from './components/ReportsTab';
import LandingPage from './components/LandingPage';

export default function App() {
  const [showLanding, setShowLanding] = useState(() => {
    return localStorage.getItem('pice_admin_logged_in') !== 'true';
  });
  const [currentTab, setCurrentTab] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [fines, setFines] = useState([]);

  useEffect(() => {
    if (!showLanding) {
      fetchAllData();
    }
  }, [showLanding]);

  async function fetchAllData() {
    try {
      // 1. Fetch student profiles from Main FCO database
      const { data: studentData } = await supabase
        .from('profiles')
        .select('*')
        .or('course.ilike.%Civil%,course.ilike.%BSCE%');
      setStudents(studentData || []);

      // 2. Fetch PICE sub-organization tables from Secondary Attendance Database via piceClient
      const { data: eventData } = await piceClient
        .from('pice_events')
        .select('*')
        .eq('organization_id', PICE_ORG_ID);
      setEvents(eventData || []);

      const { data: attData } = await piceClient
        .from('pice_attendance')
        .select('*');
      setAttendance(attData || []);

      const { data: fineData } = await piceClient
        .from('pice_fines')
        .select('*');
      setFines(fineData || []);
    } catch (err) {
      console.error('Error fetching global PICE app data:', err);
    }
  }

  function handleLoginSuccess() {
    localStorage.setItem('pice_admin_logged_in', 'true');
    setShowLanding(false);
  }

  function handleSignOut() {
    localStorage.removeItem('pice_admin_logged_in');
    setShowLanding(true);
  }

  if (showLanding) {
    return <LandingPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', fontFamily: 'sans-serif' }}>
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        collapsed={collapsed} 
        setCollapsed={setCollapsed} 
        onSignOut={handleSignOut}
      />

      <main style={{ marginLeft: collapsed ? '80px' : '280px', flex: 1, padding: '36px', overflowY: 'auto', transition: 'margin-left 0.3s ease' }}>
        {currentTab === 'overview' && (
          <OverviewTab 
            students={students} 
            events={events} 
            fines={fines} 
            attendance={attendance}
            refreshData={fetchAllData} 
            setCurrentTab={setCurrentTab} 
          />
        )}

        {currentTab === 'events' && (
          <EventsTab />
        )}

        {currentTab === 'masterlist' && (
          <MasterlistTab students={students} />
        )}

        {(currentTab === 'attendance' || currentTab === 'attendance-records') && (
          <AttendanceTab currentUser={{ email: 'pice.admin@essu.edu.ph' }} />
        )}

        {(currentTab === 'fines' || currentTab === 'fine-management') && (
          <FineManagementTab currentUser={{ email: 'pice.admin@essu.edu.ph' }} />
        )}

        {(currentTab === 'summary' || currentTab === 'student-summary') && (
          <StudentSummaryTab currentUser={{ email: 'pice.admin@essu.edu.ph' }} />
        )}

        {(currentTab === 'reports' || currentTab === 'audit' || currentTab === 'reports-audits') && (
          <ReportsTab currentUser={{ email: 'pice.admin@essu.edu.ph' }} />
        )}

        {!['overview', 'events', 'masterlist', 'attendance', 'attendance-records', 'fines', 'fine-management', 'summary', 'student-summary', 'reports', 'audit', 'reports-audits'].includes(currentTab) && (
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '900', textTransform: 'uppercase', marginBottom: '24px' }}>{currentTab.replace('-', ' ')}</h1>
            <div style={{ backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b', fontWeight: '600' }}>
              Module interface loaded and active for PICE organization ledger.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
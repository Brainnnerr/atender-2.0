import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { attendanceClient } from '../services/attendanceClient';

import HomeTab from './tabs/HomeTab';
import ProfileTab from './tabs/ProfileTab';
import SettingsTab from './tabs/SettingsTab';
import QRScannerModal from './QRScannerModal';

export default function StudentDashboard({ profile: initialProfile, onSignOut }) {
  const [profile, setProfile] = useState(initialProfile || null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [scannerVisible, setScannerVisible] = useState(false);

  const [events, setEvents] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [totalFines, setTotalFines] = useState(0.0);

  // Sub-Organization States
  const [subOrgEvents, setSubOrgEvents] = useState([]);
  const [subOrgAttendance, setSubOrgAttendance] = useState({});
  const [subOrgFines, setSubOrgFines] = useState(0.0);

  const studentUserId = initialProfile?.id || profile?.id;

  useEffect(() => {
    loadDashboardData();

    if (!studentUserId) return;

    const channel = supabase
      .channel(`student_realtime_sync_${studentUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fines' }, () => loadDashboardData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadDashboardData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => loadDashboardData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentUserId, profile?.course]);

  const loadDashboardData = async () => {
    try {
      if (!refreshing) setLoading(true);

      if (!studentUserId) {
        if (onSignOut) onSignOut();
        return;
      }

      const course = (profile?.course || '').toUpperCase();

      let subOrgEventsTable = 'pice_events';
      let subOrgAttendanceTable = 'pice_attendance';
      let subOrgFinesTable = 'pice_fines';
      let subOrgRpcName = 'generate_pice_expired_event_fines';

      if (course.includes('BSEE') || course.includes('ELECTRICAL')) {
        subOrgEventsTable = 'iiee_events';
        subOrgAttendanceTable = 'iiee_attendance';
        subOrgFinesTable = 'iiee_fines';
        subOrgRpcName = 'generate_iiee_expired_event_fines';
      } else if (course.includes('BSCE') || course.includes('CIVIL')) {
        subOrgEventsTable = 'pice_events';
        subOrgAttendanceTable = 'pice_attendance';
        subOrgFinesTable = 'pice_fines';
        subOrgRpcName = 'generate_pice_expired_event_fines';
      }

      try {
        await attendanceClient.rpc(subOrgRpcName);
      } catch (rpcErr) {
        console.log('Sub-org auto-fine check notice:', rpcErr?.message);
      }

      // 1. FETCH MAIN FCO FINES FOR THIS STUDENT
      const { data: finesData } = await supabase
        .from('fines')
        .select('amount, status, event_id')
        .eq('student_id', studentUserId);

      let paidEventIds = [];
      let totalUnpaidSum = 0;

      if (finesData) {
        finesData.forEach((f) => {
          const statusStr = String(f.status || '').toLowerCase();
          if (statusStr === 'paid' && f.event_id) {
            paidEventIds.push(f.event_id);
          }
          if (!f.status || statusStr === '' || ['unpaid', 'pending_approval', 'pending'].includes(statusStr)) {
            totalUnpaidSum += parseFloat(f.amount) || 0;
          }
        });
        setTotalFines(totalUnpaidSum);
      }

      // 5. FETCH MAIN FCO ATTENDANCE
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select('event_id, time_in, time_out, status')
        .eq('student_id', studentUserId);

      if (attendanceData) {
        const attendanceMap = {};
        attendanceData.forEach((rec) => { 
          attendanceMap[rec.event_id] = rec; 
          if (rec.time_in || rec.status === 'present') {
            paidEventIds.push(rec.event_id);
          }
        });
        setAttendanceRecords(attendanceMap);
      }
      
      // 6. FETCH SUB-ORG ATTENDANCE (Mula sa Secondary DB)
      const { data: subAttData } = await attendanceClient
        .from(subOrgAttendanceTable)
        .select('event_id, time_in, time_out, status')
        .eq('student_id', studentUserId);

      let subAttendanceMap = {};
      let subOrgPaidEventIds = [];

      if (subAttData) {
        subAttData.forEach((rec) => { 
          subAttendanceMap[rec.event_id] = rec; 
          // 🚀 Kapag may attendance log (logged), itatago na rin ito sa active events list
          if (rec.time_in || rec.time_out || rec.status === 'present') {
            subOrgPaidEventIds.push(rec.event_id);
          }
        });
        setSubOrgAttendance(subAttendanceMap);
      }

      // 2. FETCH SUB-ORG FINES FOR THIS STUDENT
      let subOrgUnpaidSum = 0;

      if (subOrgFinesTable && (course.includes('BSCE') || course.includes('BSEE') || course.includes('CIVIL') || course.includes('ELECTRICAL'))) {
        const { data: subFinesData } = await attendanceClient
          .from(subOrgFinesTable)
          .select('amount, status, event_id')
          .eq('student_id', studentUserId);

        if (subFinesData) {
          subFinesData.forEach((f) => {
            const fStatus = String(f.status || '').toLowerCase();
            if (fStatus === 'paid' && f.event_id) {
              subOrgPaidEventIds.push(f.event_id);
            }
            if (!f.status || fStatus === '' || ['unpaid', 'pending_approval', 'pending'].includes(fStatus)) {
              subOrgUnpaidSum += parseFloat(f.amount) || 0;
            }
          });
        }
      }

      setSubOrgFines(subOrgUnpaidSum);

      // 3. FETCH MAIN FCO EVENTS
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, location, start_time, end_time, fine_amount, semester')
        .order('start_time', { ascending: false });

      const activeEvents = (eventsData || []).filter(evt => {
        const isPaid = paidEventIds.includes(evt.id);
        return !isPaid; 
      });
      setEvents(activeEvents);

      // 4. FETCH SUB-ORG EVENTS
      const { data: subOrgEventsData } = await attendanceClient
        .from(subOrgEventsTable)
        .select('*')
        .order('start_time', { ascending: false });

      if (subOrgEventsData) {
        const activeSubEvents = subOrgEventsData.filter(evt => {
          const isPaid = subOrgPaidEventIds.includes(evt.id);
          return !isPaid; // Itatago na ang event kung na-attendan na O kaya ay bayad na ang fine
        });
        setSubOrgEvents(activeSubEvents);
      }

    } catch (err) {
      console.log('Dashboard sync warning:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Sign out error:', e);
    } finally {
      if (onSignOut) onSignOut();
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#8b0000" />
        <Text style={styles.loadingText}>Syncing Atender Feed...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

        {activeTab === 'home' && (
          <HomeTab
            profile={profile}
            events={events}
            attendanceRecords={attendanceRecords}
            totalFines={totalFines}
            subOrgEvents={subOrgEvents}
            subOrgAttendance={subOrgAttendance}
            subOrgFines={subOrgFines}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadDashboardData();
            }}
            onSignOut={handleSignOut}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileTab 
            profile={profile} 
            onProfileUpdated={(updatedFields) => {
              if (updatedFields) setProfile(updatedFields);
              loadDashboardData();
            }} 
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab 
            profile={profile} 
            onSignOut={handleSignOut} 
          />
        )}

        {/* CURVED BOTTOM NAVBAR */}
        <View style={styles.bottomBarContainer}>
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')} activeOpacity={0.7}>
              <Ionicons name={activeTab === 'home' ? 'home' : 'home-outline'} size={22} color={activeTab === 'home' ? '#ffffff' : '#fca5a5'} />
              <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('profile')} activeOpacity={0.7}>
              <Ionicons name={activeTab === 'profile' ? 'person' : 'person-outline'} size={22} color={activeTab === 'profile' ? '#ffffff' : '#fca5a5'} />
              <Text style={[styles.navLabel, activeTab === 'profile' && styles.navLabelActive]}>Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('settings')} activeOpacity={0.7}>
              <Ionicons name={activeTab === 'settings' ? 'settings' : 'settings-outline'} size={22} color={activeTab === 'settings' ? '#ffffff' : '#fca5a5'} />
              <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>Settings</Text>
            </TouchableOpacity>

            <View style={styles.navItemSpacer} />
          </View>

          {/* Main FCO Elevated QR Code Button */}
          <TouchableOpacity
            style={styles.elevatedQrButton}
            activeOpacity={0.88}
            onPress={() => setScannerVisible(true)}
          >
            <View style={styles.qrIconInner}>
              <Ionicons name="qr-code-outline" size={28} color="#8b0000" />
            </View>
            <Text style={styles.qrButtonLabel}>Scan QR</Text>
          </TouchableOpacity>
        </View>

        {/* Main FCO QR Scanner Modal */}
        <QRScannerModal
          visible={scannerVisible}
          profile={profile}
          onClose={() => setScannerVisible(false)}
          onScanComplete={loadDashboardData}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centerContainer: { flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#64748b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 12 },
  bottomBarContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50 },
  bottomBar: {
    height: Platform.OS === 'ios' ? 84 : 72,
    backgroundColor: '#8b0000',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 20 : 4,
    elevation: 10,
  },
  navItem: { alignItems: 'center', justifyContent: 'center', width: 60, paddingVertical: 4 },
  navItemSpacer: { width: 68 },
  navLabel: { fontSize: 10, fontWeight: '700', color: '#fca5a5', marginTop: 3 },
  navLabelActive: { color: '#ffffff', fontWeight: '900' },
  elevatedQrButton: { position: 'absolute', top: Platform.OS === 'ios' ? -22 : -24, right: 22, alignItems: 'center', zIndex: 999, elevation: 20 },
  qrIconInner: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#ffffff', borderWidth: 3.5, borderColor: '#8b0000',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 12,
  },
  qrButtonLabel: { fontSize: 10, fontWeight: '900', color: '#ffffff', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
});
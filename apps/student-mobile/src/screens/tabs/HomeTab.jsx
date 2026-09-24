import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function HomeTab({
  profile,
  events,
  attendanceRecords,
  totalFines,
  subOrgEvents = [],
  subOrgAttendance = {},
  subOrgFines = 0,
  refreshing,
  onRefresh,
  onSignOut,
}) {
  const [activeTab, setActiveTab] = useState('fco');

  // Determine Sub-Org & Theme based on student course
  const course = (profile?.course || '').toUpperCase();
  let subOrgName = '';
  let subOrgCode = '';
  let subOrgColor = '#b45309'; // Default bronze for PICE
  let subOrgCardBg = '#ffffff';
  let subOrgBadgeBg = 'rgba(180, 83, 9, 0.15)';
  let subOrgBorderColor = '#e2e8f0';

  if (course.includes('BSCE') || course.includes('CIVIL')) {
    subOrgName = 'Philippine Institute of Civil Engineers';
    subOrgCode = 'PICE FINES';
    subOrgColor = '#b45309';
    subOrgCardBg = '#ffffff';
    subOrgBadgeBg = 'rgba(180, 83, 9, 0.15)';
    subOrgBorderColor = '#e2e8f0';
  } else if (course.includes('BSEE') || course.includes('ELECTRICAL')) {
    subOrgName = 'Institute of Integrated Electrical Engineers';
    subOrgCode = 'IIEE FINES';
    subOrgColor = '#854d0e';
    subOrgCardBg = '#ffffff'; 
    subOrgBorderColor = '#e2e8f0';
    subOrgBadgeBg = 'rgba(133, 77, 14, 0.15)';
  } else if (course.includes('BSCpE') || course.includes('COMPUTER')) {
    subOrgName = '';
    subOrgCode = '';
  }

  // Filter sub-org events: Kapag ang subOrgFines ay 0 na (ibig sabihin nabayaran/na-mark as paid na ng admin), 
  // o kaya ay may attendance na, itatago na natin ang mga ito sa HomeTab para hindi na makita ng estudyante.
  const studentFilteredSubEvents = subOrgEvents.filter((evt) => {
    const orgTarget = (evt.organization_type || evt.target_department || '').toUpperCase();
    const isMatchedCourse = 
      (course.includes('BSCE') && (orgTarget.includes('PICE') || orgTarget.includes('BSCE'))) ||
      (course.includes('BSEE') && (orgTarget.includes('IIEE') || orgTarget.includes('BSEE'))) ||
      (!orgTarget || orgTarget === 'ALL');

    if (!isMatchedCourse) return false;

    // 🚀 KUNG ANG TOTAL SUB-ORG FINES AY 0 NA (Nalinis/Na-mark as paid na ng admin), itago na ang lahat ng events
    if (subOrgFines <= 0) {
      return false;
    }

    // O kaya kung may attendance log na (Logged)
    const attLog = subOrgAttendance[evt.id];
    const hasAttended = !!(attLog?.time_in || attLog?.time_out || attLog?.status === 'present');

    if (hasAttended) {
      return false;
    }

    return true;
  });

  return (
    <ScrollView
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8b0000" />
      }
    >
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.greetingSub}>ATENDER PORTAL</Text>
          <Text style={styles.greetingName}>
            Hello, {profile?.full_name?.split(' ')[0] || 'Student'}
          </Text>
        </View>

        <TouchableOpacity onPress={onSignOut} style={styles.logoutPill} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={14} color="#8b0000" style={{ marginRight: 4 }} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* 1. Main FCO Outstanding Fines Card */}
      <View style={styles.fineCard}>
        <View style={styles.fineHeader}>
          <Text style={styles.fineCardTitle}>MAIN FCO FINES</Text>
          <View style={styles.fineStatusTag}>
            <Text style={styles.fineStatusText}>
              {totalFines > 0 ? 'ACTION NEEDED' : 'CLEARED'}
            </Text>
          </View>
        </View>
        <Text style={styles.fineAmount}>₱{totalFines.toFixed(2)}</Text>
        <Text style={styles.fineDescription}>
          {totalFines > 0
            ? 'Accumulated penalty for unexcused main FCO event absences.'
            : 'You have no outstanding FCO event fines. Keep it up!'}
        </Text>
      </View>

      {/* 2. Department Sub-Organization Fines Card */}
      {subOrgCode ? (
        <View style={[styles.fineCard, { backgroundColor: subOrgCardBg, borderColor: subOrgBorderColor, borderWidth: 1.5 }]}>
          <View style={styles.fineHeader}>
            <Text style={[styles.fineCardTitle, { color: subOrgColor }]}>{subOrgCode}</Text>
            <View style={[styles.fineStatusTag, { backgroundColor: subOrgBadgeBg }]}>
              <Text style={[styles.fineStatusText, { color: subOrgColor }]}>
                {subOrgFines > 0 ? 'ACTION NEEDED' : 'CLEARED'}
              </Text>
            </View>
          </View>
          <Text style={[styles.fineAmount, { color: '#0f172a' }]}>₱{subOrgFines.toFixed(2)}</Text>
          <Text style={[styles.fineDescription, { color: '#64748b' }]}>
            {subOrgFines > 0
              ? `Accumulated penalty for unexcused ${subOrgCode.split(' ')[0]} event absences.`
              : `You have no outstanding ${subOrgCode.split(' ')[0]} fines. Keep it up!`}
          </Text>
        </View>
      ) : null}

      {/* 3. FCO & Sub-Org Interactive Tab Switcher */}
      {subOrgCode ? (
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'fco' && styles.tabButtonActive]}
            onPress={() => setActiveTab('fco')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === 'fco' && styles.tabTextActive]}>
              Main FCO Assemblies ({events.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'suborg' && styles.tabButtonActive]}
            onPress={() => setActiveTab('suborg')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === 'suborg' && styles.tabTextActive]}>
              {subOrgName ? `${subOrgCode.split(' ')[0]} Events` : 'Sub-Org'} ({studentFilteredSubEvents.length})
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 4. Tab Content: Main FCO Tab */}
      {(activeTab === 'fco' || !subOrgCode) && (
        <>
          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={36} color="#94a3b8" />
              <Text style={styles.emptyText}>No main FCO assemblies listed yet.</Text>
            </View>
          ) : (
            events.map((evt) => {
              const att = attendanceRecords[evt.id];
              const hasRecord = !!(att?.time_in || att?.time_out);
              const recordedTime = att?.time_in || att?.time_out;

              return (
                <View key={evt.id} style={styles.eventCardItem}>
                  <View style={styles.eventHeaderRow}>
                    <Text style={styles.eventTitle}>{evt.title}</Text>
                    <View style={styles.penaltyBadge}>
                      <Text style={styles.penaltyBadgeText}>
                        ₱{parseFloat(evt.fine_amount || 0).toFixed(0)} Fine
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color="#64748b" />
                    <Text style={styles.eventLocation}> {evt.location || 'ESSU Gymnasium'}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={13} color="#94a3b8" />
                    <Text style={styles.eventTime}>
                      {' '}
                      {new Date(evt.start_time).toLocaleDateString()} •{' '}
                      {new Date(evt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(evt.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="school-outline" size={13} color="#94a3b8" />
                    <Text style={styles.eventSemester}> {evt.semester || '1st Semester'}</Text>
                  </View>

                  <View style={styles.statusBoxContainer}>
                    <View style={[styles.statusBox, hasRecord ? styles.statusBoxSuccess : styles.statusBoxPending]}>
                      <View style={styles.statusHeaderRow}>
                        <Text style={[styles.statusBoxLabel, hasRecord ? styles.statusTextSuccess : styles.statusTextPending]}>
                          {hasRecord ? '✓ LOGGED' : '○ NO RECORD'}
                        </Text>
                        {hasRecord && <Ionicons name="checkmark-circle" size={14} color="#059669" />}
                      </View>
                      <Text style={styles.statusBoxTime}>
                        {hasRecord
                          ? `Scanned at ${new Date(recordedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Pending QR Scan'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </>
      )}

      {/* 5. Tab Content: Sub-Org Tab */}
      {subOrgCode && activeTab === 'suborg' && (
        <>
          {studentFilteredSubEvents.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={36} color="#94a3b8" />
              <Text style={styles.emptyText}>No pending events for your department sub-org.</Text>
            </View>
          ) : (
            studentFilteredSubEvents.map((evt) => {
              const log = subOrgAttendance[evt.id];
              const isCheckedIn = !!(log?.time_in || log?.time_out);
              const recordedTime = log?.time_in || log?.time_out;

              return (
                <View key={evt.id} style={styles.eventCardItem}>
                  <View style={styles.eventHeaderRow}>
                    <Text style={styles.eventTitle}>{evt.title}</Text>
                    <View style={[styles.penaltyBadge, { backgroundColor: subOrgBadgeBg, borderColor: subOrgColor }]}>
                      <Text style={[styles.penaltyBadgeText, { color: subOrgColor }]}>
                        ₱{parseFloat(evt.fine_amount || 0).toFixed(0)} Fine
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color="#64748b" />
                    <Text style={styles.eventLocation}> {evt.location || 'ESSU Department Venue'}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={13} color="#94a3b8" />
                    <Text style={styles.eventTime}>
                      {' '}
                      {new Date(evt.start_time).toLocaleDateString()} •{' '}
                      {new Date(evt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(evt.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="school-outline" size={13} color="#94a3b8" />
                    <Text style={styles.eventSemester}> {evt.semester || '1st Semester'}</Text>
                  </View>

                  <View style={styles.statusBoxContainer}>
                    <View style={[styles.statusBox, isCheckedIn ? styles.statusBoxSuccess : styles.statusBoxPending]}>
                      <View style={styles.statusHeaderRow}>
                        <Text style={[styles.statusBoxLabel, isCheckedIn ? styles.statusTextSuccess : styles.statusTextPending]}>
                          {isCheckedIn ? '✓ LOGGED' : '○ NO RECORD'}
                        </Text>
                        {isCheckedIn && <Ionicons name="checkmark-circle" size={14} color="#059669" />}
                      </View>
                      <Text style={styles.statusBoxTime}>
                        {isCheckedIn
                          ? `Scanned at ${new Date(recordedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Pending Chapter QR Scan'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 54, paddingBottom: 110 },
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greetingSub: { fontSize: 11, fontWeight: '800', color: '#8b0000', letterSpacing: 1.5 },
  greetingName: { fontSize: 22, fontWeight: '900', color: '#0f172a', marginTop: 2 },
  logoutPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12 },
  logoutText: { color: '#8b0000', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  
  fineCard: { backgroundColor: '#8b0000', borderRadius: 20, padding: 20, marginBottom: 16, elevation: 6 },
  fineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fineCardTitle: { color: '#fecaca', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  fineStatusTag: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  fineStatusText: { color: '#ffffff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  fineAmount: { color: '#ffffff', fontSize: 34, fontWeight: '900', marginTop: 8 },
  fineDescription: { color: '#fee2e2', fontSize: 12, fontWeight: '500', marginTop: 4, lineHeight: 16 },

  tabContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 14, padding: 4, marginBottom: 20 },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  tabButtonActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  tabText: { fontSize: 12, fontWeight: '800', color: '#64748b', textTransform: 'uppercase' },
  tabTextActive: { color: '#8b0000' },

  emptyContainer: { backgroundColor: '#ffffff', padding: 36, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: '#e2e8f0' },
  emptyText: { color: '#94a3b8', fontSize: 13, fontWeight: '600', marginTop: 8 },
  eventCardItem: { backgroundColor: '#ffffff', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1.5, borderColor: '#e2e8f0', elevation: 2 },
  eventHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  eventTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', flex: 1, paddingRight: 8 },
  penaltyBadge: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  penaltyBadgeText: { color: '#8b0000', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  eventLocation: { color: '#64748b', fontSize: 12, fontWeight: '600' , flex: 1 },
  eventTime: { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
  eventSemester: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  statusBoxContainer: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderColor: '#f1f5f9' },
  statusBox: { width: '100%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 },
  statusBoxSuccess: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' },
  statusBoxPending: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  statusHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBoxLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  statusTextSuccess: { color: '#059669' },
  statusTextPending: { color: '#94a3b8' },
  statusBoxTime: { fontSize: 11, fontWeight: '700', color: '#334155', marginTop: 3 },
});
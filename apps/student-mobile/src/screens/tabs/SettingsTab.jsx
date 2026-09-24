import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../services/supabase';
import SubOrgQRScannerModal from '../SubOrgQRScannerModal';

const { width } = Dimensions.get('window');

export default function SettingsTab({ profile, onSignOut }) {
  // Password Modal State
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Sign Out Confirmation Modal State
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);

  // Sub-Org QR Scanner Modal State
  const [subOrgScannerVisible, setSubOrgScannerVisible] = useState(false);

  // Profile QR Code Modal State (For Offline Scanning by Admins)
  const [profileQrModalVisible, setProfileQrModalVisible] = useState(false);

  // Show / Hide Password Visibility Toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const course = (profile?.course || '').toUpperCase();
  const chapterCode = course.includes('BSEE') || course.includes('ELECTRICAL') 
    ? 'IIEE' 
    : course.includes('BSCE') || course.includes('CIVIL') 
    ? 'PICE' 
    : 'Sub-Org';

  // Universal student payload for offline scanning
  const studentQrPayload = JSON.stringify({
    type: 'ATENDER_STUDENT_PROFILE',
    studentId: profile?.student_id || 'N/A',
    name: profile?.full_name || 'N/A',
    course: profile?.course || 'N/A',
    yearLevel: profile?.year_level || '',
    section: profile?.section || '',
  });

  const handleChangePasswordSubmit = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) {
      Alert.alert('Missing Fields', 'Please enter your current and new password.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Weak Password', 'New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      let userId = profile?.id;
      if (!userId) {
        const { data: authData } = await supabase.auth.getUser();
        userId = authData?.user?.id;
      }

      if (!userId) {
        Alert.alert('Error', 'User session not found. Please log in again.');
        return;
      }

      const { data: res, error } = await supabase.rpc('student_change_password', {
        p_user_id: userId,
        p_new_password: newPassword.trim(),
      });

      if (error || !res?.success) {
        Alert.alert('Failed', res?.message || error?.message || 'Could not update password.');
        return;
      }

      Alert.alert('Success', 'Your password has been changed successfully.');
      setPasswordModalVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (err) {
      Alert.alert('Error', err.message || 'An unexpected error occurred.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.topHeader}>
        <Text style={styles.greetingSub}>SECURITY & PREFERENCES</Text>
        <Text style={styles.greetingName}>Account Settings</Text>
      </View>

      {/* 1. Universal Member QR Code Card (Works Offline for All FCO & Sub-Orgs) */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Universal Member QR Code</Text>
        <Text style={styles.cardSubText}>
          Present this QR code to event admins to log attendance instantly, even without internet connection.
        </Text>

        <TouchableOpacity
          onPress={() => setProfileQrModalVisible(true)}
          style={styles.qrPreviewContainer}
          activeOpacity={0.85}
        >
          <View style={styles.miniQrWrapper}>
            <QRCode value={studentQrPayload} size={84} backgroundColor="#ffffff" color="#0f172a" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.qrCardTitle}>View Full-Screen QR</Text>
            <Text style={styles.qrCardSub}>Contains your Student ID, Name, and Program for offline scanning.</Text>
          </View>
          <Ionicons name="expand-outline" size={20} color="#8b0000" />
        </TouchableOpacity>
      </View>

      {/* 2. Security & Account Actions */}
      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.cardHeader}>Security & Account</Text>

        {/* Sub-Org Scanner Trigger */}
        {chapterCode !== 'Sub-Org' && (
          <TouchableOpacity
            onPress={() => setSubOrgScannerVisible(true)}
            style={styles.settingsRow}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="qr-code-outline" size={18} color="#854d0e" style={styles.rowIcon} />
              <Text style={[styles.rowTitle, { color: '#854d0e' }]}>Scan {chapterCode} Chapter QR</Text>
            </View>
            <Ionicons name="chevron-forward-outline" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => setPasswordModalVisible(true)}
          style={styles.settingsRow}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Ionicons name="key-outline" size={18} color="#0f172a" style={styles.rowIcon} />
            <Text style={styles.rowTitle}>Change Password</Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={18} color="#94a3b8" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSignOutModalVisible(true)}
          style={[styles.settingsRow, { borderBottomWidth: 0 }]}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Ionicons name="log-out-outline" size={18} color="#8b0000" style={styles.rowIcon} />
            <Text style={[styles.rowTitle, { color: '#8b0000' }]}>Sign Out</Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={18} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* 3. Full-Screen Profile QR Code Modal */}
      <Modal
        visible={profileQrModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setProfileQrModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { alignItems: 'center', paddingVertical: 24 }]}>
            <View style={[styles.modalHeader, { width: '100%', marginBottom: 16 }]}>
              <Text style={styles.modalTitle}>My Member QR Code</Text>
              <TouchableOpacity onPress={() => setProfileQrModalVisible(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'center', marginBottom: 20 }}>
              Use this code for offline attendance scanning across all FCO and sub-organizations.
            </Text>

            <View style={styles.largeQrContainer}>
              <QRCode value={studentQrPayload} size={200} backgroundColor="#ffffff" color="#0f172a" />
            </View>

            <View style={styles.qrProfileInfoBox}>
              <Text style={styles.qrStudentName}>{profile?.full_name || 'Student Member'}</Text>
              <Text style={styles.qrStudentId}>{profile?.student_id || 'ID N/A'}</Text>
              <Text style={styles.qrStudentCourse}>
                {profile?.course || 'BSCE'} • {profile?.year_level ? `Year ${profile.year_level}` : ''} {profile?.section ? `Sec ${profile.section}` : ''}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setProfileQrModalVisible(false)}
              style={[styles.submitBtn, { width: '100%', marginTop: 20 }]}
            >
              <Text style={styles.submitBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 4. Password Change Modal */}
      <Modal
        visible={passwordModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setPasswordModalVisible(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Current Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Current Password</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  secureTextEntry={!showCurrentPassword}
                  placeholder="Enter current password"
                  placeholderTextColor="#94a3b8"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showCurrentPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* New Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>New Password (Min. 6 chars)</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  secureTextEntry={!showNewPassword}
                  placeholder="Enter new password"
                  placeholderTextColor="#94a3b8"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowNewPassword(!showNewPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showNewPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm New Password</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  secureTextEntry={!showConfirmPassword}
                  placeholder="Re-type new password"
                  placeholderTextColor="#94a3b8"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setPasswordModalVisible(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleChangePasswordSubmit}
                disabled={changingPassword}
                style={styles.submitBtn}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 5. Sign Out Confirmation Modal */}
      <Modal
        visible={signOutModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSignOutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sign Out</Text>
              <TouchableOpacity onPress={() => setSignOutModalVisible(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 20, lineHeight: 18 }}>
              Are you sure you want to sign out of your student session?
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setSignOutModalVisible(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setSignOutModalVisible(false);
                  onSignOut();
                }}
                style={[styles.submitBtn, { backgroundColor: '#8b0000' }]}
              >
                <Text style={styles.submitBtnText}>Yes, Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 6. Sub-Organization QR Scanner Modal */}
      <SubOrgQRScannerModal
        visible={subOrgScannerVisible}
        profile={profile}
        onClose={() => setSubOrgScannerVisible(false)}
        onScanComplete={() => {
          setSubOrgScannerVisible(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 22, paddingTop: 54, paddingBottom: 110 },
  topHeader: { marginBottom: 20 },
  greetingSub: { fontSize: 11, fontWeight: '800', color: '#8b0000', letterSpacing: 1.5 },
  greetingName: { fontSize: 22, fontWeight: '900', color: '#0f172a', marginTop: 2 },
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 18, borderWidth: 1.5, borderColor: '#e2e8f0' },
  cardHeader: { fontSize: 11, fontWeight: '900', color: '#8b0000', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  cardSubText: { fontSize: 11, color: '#64748b', marginBottom: 12, lineHeight: 16 },
  qrPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  miniQrWrapper: {
    backgroundColor: '#ffffff',
    padding: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  qrCardTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  qrCardSub: { fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 15 },
  largeQrContainer: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  qrProfileInfoBox: {
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  qrStudentName: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  qrStudentId: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: '800', color: '#8b0000', marginTop: 2 },
  qrStudentCourse: { fontSize: 11, color: '#64748b', fontWeight: '600', marginTop: 2 },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  rowLeft: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { marginRight: 10 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#ffffff', width: '100%', maxWidth: 360, borderRadius: 20, padding: 20, borderWidth: 1.5, borderColor: '#e2e8f0' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 13,
    color: '#0f172a',
  },
  eyeBtn: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, height: 42, backgroundColor: '#f1f5f9', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  submitBtn: { flex: 1, height: 42, backgroundColor: '#8b0000', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
});
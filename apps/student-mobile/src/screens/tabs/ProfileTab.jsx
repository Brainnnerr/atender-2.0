import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

export default function ProfileTab({ profile, onProfileUpdated }) {
  const [avatarUri, setAvatarUri] = useState(profile?.avatar_url || null);
  const [editEmail, setEditEmail] = useState(profile?.email || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  const handlePickAvatar = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.25,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUploadingAvatar(true);

        const ext = asset.uri.split('.').pop().toLowerCase() || 'jpeg';
        let formattedBase64 = asset.base64 
          ? (asset.base64.startsWith('data:image') ? asset.base64 : `data:image/${ext};base64,${asset.base64}`)
          : null;

        if (!formattedBase64) {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          formattedBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }

        setAvatarUri(formattedBase64);

        // Safe RPC call with structured error response
        const { data: res, error } = await supabase.rpc('student_update_profile', {
          p_user_id: profile.id,
          p_email: null,
          p_avatar_url: formattedBase64,
        });

        if (error) throw error;
        if (res && res.success === false) {
          throw new Error(res.message || 'Database rejected the avatar update.');
        }

        Alert.alert('Success', 'Profile picture updated successfully.');
        if (onProfileUpdated) {
          onProfileUpdated({ ...profile, avatar_url: formattedBase64 });
        }
      }
    } catch (err) {
      Alert.alert('Update Error', err.message || 'Could not update profile photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!editEmail.trim()) {
      Alert.alert('Required', 'Please provide a valid email address.');
      return;
    }

    try {
      setSaving(true);
      const cleanEmail = editEmail.trim().toLowerCase();

      // Safe RPC call with structured error response
      const { data: res, error } = await supabase.rpc('student_update_profile', {
        p_user_id: profile.id,
        p_email: cleanEmail,
        p_avatar_url: null,
      });

      if (error) throw error;
      if (res && res.success === false) {
        throw new Error(res.message || 'Database rejected the email update.');
      }

      Alert.alert('Success', 'Email updated successfully.');
      if (onProfileUpdated) {
        onProfileUpdated({ ...profile, email: cleanEmail });
      }
    } catch (err) {
      Alert.alert('Update Error', err.message || 'Unable to update email.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.topHeader}>
          <Text style={styles.greetingSub}>STUDENT PROFILE</Text>
          <Text style={styles.greetingName}>Personal Master Record</Text>
        </View>

        {/* Profile Avatar Card with Interactive Camera Overlay */}
        <View style={styles.profileAvatarCard}>
          <View style={styles.avatarWrapper}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarLetter}>{profile?.full_name?.charAt(0) || 'S'}</Text>
              </View>
            )}

            {/* Circular Camera Overlay Button */}
            <TouchableOpacity
              style={styles.cameraIconBadge}
              onPress={handlePickAvatar}
              disabled={uploadingAvatar}
              activeOpacity={0.8}
            >
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="camera" size={16} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.profileMainName}>{profile?.full_name}</Text>
          <Text style={styles.profileMainId}>{profile?.student_id}</Text>
        </View>

        {/* Academic Details (Read Only) */}
        <View style={styles.detailsGroupCard}>
          <Text style={styles.groupCardHeading}>Academic Credentials</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Full Name</Text>
            <Text style={styles.detailValue}>{profile?.full_name}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Student Number</Text>
            <Text style={styles.detailValueMono}>{profile?.student_id}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Program / Course</Text>
            <Text style={styles.detailValue}>{profile?.course}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Year & Section</Text>
            <Text style={styles.detailValue}>
              {profile?.year_level}{profile?.section}
            </Text>
          </View>
        </View>

        {/* Editable Details */}
        <View style={styles.detailsGroupCard}>
          <Text style={styles.groupCardHeading}>Editable Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Registered Email Address</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter active email address"
              placeholderTextColor="#94a3b8"
              value={editEmail}
              onChangeText={setEditEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            onPress={handleSaveProfile}
            disabled={saving}
            style={styles.saveProfileButton}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.saveProfileButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 22, paddingTop: 54, paddingBottom: 110 },
  topHeader: { marginBottom: 20 },
  greetingSub: { fontSize: 11, fontWeight: '800', color: '#8b0000', letterSpacing: 1.5 },
  greetingName: { fontSize: 22, fontWeight: '900', color: '#0f172a', marginTop: 2 },
  profileAvatarCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  avatarWrapper: {
    position: 'relative',
    width: 96,
    height: 96,
    marginBottom: 12,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#8b0000',
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#8b0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#ffffff', fontSize: 38, fontWeight: '900' },
  cameraIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#8b0000',
    borderWidth: 2.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  profileMainName: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  profileMainId: { fontSize: 13, fontWeight: '700', color: '#8b0000', marginTop: 2 },
  detailsGroupCard: { backgroundColor: '#ffffff', borderRadius: 20, padding: 20, borderWidth: 1.5, borderColor: '#e2e8f0', marginBottom: 16 },
  groupCardHeading: { fontSize: 12, fontWeight: '900', color: '#8b0000', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  detailLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  detailValue: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginTop: 2 },
  detailValueMono: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#334155', textTransform: 'uppercase', marginBottom: 6 },
  textInput: { height: 48, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, fontSize: 14, color: '#0f172a' },
  saveProfileButton: { backgroundColor: '#8b0000', height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  saveProfileButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
});
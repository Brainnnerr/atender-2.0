import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  StatusBar,
  Dimensions,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../services/supabase';
import { attendanceClient } from '../services/attendanceClient';
import { initOfflineDB } from '../services/offlineDb';
import { Html5QrcodeScanner } from 'html5-qrcode';

const { width, height } = Dimensions.get('window');

export default function SubOrgQRScannerModal({ visible, profile, onClose, onScanComplete }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [step, setStep] = useState('SCAN'); // 'SCAN' | 'SELFIE' | 'UPLOADING'
  const [scannedData, setScannedData] = useState(null);
  const [facing, setFacing] = useState('back');
  const [validating, setValidating] = useState(false);
  const cameraRef = useRef(null);

  const webVideoRef = useRef(null);
  const webCanvasRef = useRef(null);
  const [webMediaStream, setWebMediaStream] = useState(null);

  const course = (profile?.course || '').toUpperCase();
  let subOrgEventsTable = 'pice_events';
  let subOrgAttendanceTable = 'pice_attendance';
  let chapterCode = 'PICE';

  if (course.includes('BSEE') || course.includes('ELECTRICAL')) {
    subOrgEventsTable = 'iiee_events';
    subOrgAttendanceTable = 'iiee_attendance';
    chapterCode = 'IIEE';
  } else if (course.includes('BSCE') || course.includes('CIVIL')) {
    subOrgEventsTable = 'pice_events';
    subOrgAttendanceTable = 'pice_attendance';
    chapterCode = 'PICE';
  }

  const stopWebcam = () => {
    if (webMediaStream) {
      webMediaStream.getTracks().forEach(track => track.stop());
      setWebMediaStream(null);
    }
  };

  useEffect(() => {
    if (visible) {
      initOfflineDB();
      setScanned(false);
      setStep('SCAN');
      setScannedData(null);
      setFacing('back');
      setValidating(false);
      stopWebcam();

      if (Platform.OS === 'web') {
        setTimeout(() => {
          const scanner = new Html5QrcodeScanner(
            'web-suborg-qr-container',
            { fps: 10, qrbox: { width: 250, height: 250 }, facingMode: "environment" },
            false
          );
          scanner.render(
            (decodedText) => {
              scanner.clear().catch(err => console.warn('Scanner clear error:', err));
              handleBarcodeScanned({ data: decodedText });
            },
            (error) => {}
          );
        }, 300);
      }
    } else {
      stopWebcam();
    }
  }, [visible]);

  const handleBarcodeScanned = async ({ data }) => {
    if (scanned || step !== 'SCAN' || validating) return;
    setScanned(true);

    try {
      const payload = JSON.parse(data);
      if (!payload.eventId) {
        Alert.alert('Invalid QR', `This is not an official ${chapterCode} QR Stand.`);
        setScanned(false);
        return;
      }

      setValidating(true);
      let eventData = null;
      let existingAttendance = null;

      try {
        const { data: liveEventData, error: evErr } = await attendanceClient
          .from(subOrgEventsTable)
          .select('id, title, start_time, end_time, fine_amount, requires_time_out')
          .eq('id', payload.eventId)
          .single();

        if (!evErr && liveEventData) eventData = liveEventData;

        const { data: liveAttendance, error: checkErr } = await attendanceClient
          .from(subOrgAttendanceTable)
          .select('*')
          .eq('event_id', payload.eventId)
          .eq('student_id', profile.id)
          .maybeSingle();

        if (!checkErr) existingAttendance = liveAttendance;
      } catch (networkErr) {
        console.log('Sub-org network error:', networkErr);
      }

      if (!eventData) {
        Alert.alert('Error', `${chapterCode} event details not found.`);
        setScanned(false);
        setValidating(false);
        return;
      }

      if (existingAttendance) {
        Alert.alert('Already Scanned', `You have already checked in for this ${chapterCode} event!`);
        if (onScanComplete) onScanComplete();
        onClose();
        return;
      }

      const now = new Date().getTime();
      const start = new Date(eventData.start_time).getTime();
      const end = new Date(eventData.end_time).getTime();
      let isOpen = now >= start && now <= end;

      if (!isOpen) {
        Alert.alert('QR SCANNING LOCKED', `${chapterCode} session is closed or has not started.`);
        if (onScanComplete) onScanComplete();
        onClose();
        return;
      }

      setScannedData(payload);
      setFacing('front');
      setStep('SELFIE');

      if (Platform.OS === 'web') {
        setTimeout(async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            setWebMediaStream(stream);
            if (webVideoRef.current) webVideoRef.current.srcObject = stream;
          } catch (e) {
            alert('Camera access denied for selfie.');
          }
        }, 200);
      }
    } catch (err) {
      Alert.alert('Error', 'Unable to process Sub-Org QR code.');
      setScanned(false);
    } finally {
      setValidating(false);
    }
  };

  const handleTakeSelfie = async () => {
    setStep('UPLOADING');
    try {
      let photoUriOrBlob = null;
      if (Platform.OS === 'web') {
        if (!webVideoRef.current || !webCanvasRef.current) throw new Error('Web camera not ready');
        const video = webVideoRef.current;
        const canvas = webCanvasRef.current;
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        photoUriOrBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.4));
        stopWebcam();
      } else {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ base64: false, quality: 0.3, skipProcessing: true });
        photoUriOrBlob = photo.uri;
      }

      const fileName = `${profile.id}_${scannedData.eventId}_${Date.now()}.jpg`;
      const filePath = `selfies/${fileName}`;

      // 🚀 Routed Storage Upload to Secondary Project via attendanceClient
      if (Platform.OS === 'web') {
        const { error: uploadErr } = await attendanceClient.storage
          .from('attendance-proofs')
          .upload(filePath, photoUriOrBlob, { contentType: 'image/jpeg' });
        if (uploadErr) throw new Error(uploadErr.message || 'Failed to upload selfie to secondary storage.');
      } else {
        const formData = new FormData();
        formData.append('file', { uri: photoUriOrBlob, name: fileName, type: 'image/jpeg' });
        const { error: uploadErr } = await attendanceClient.storage
          .from('attendance-proofs')
          .upload(filePath, formData, { contentType: 'image/jpeg' });
        if (uploadErr) throw new Error(uploadErr.message || 'Failed to upload selfie to secondary storage.');
      }

      // Get public URL from secondary project storage bucket
      const { data: urlData } = attendanceClient.storage
        .from('attendance-proofs')
        .getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl || null;

      let currentLat = null, currentLon = null;
      try {
        if (Platform.OS === 'web') {
          const position = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true }));
          currentLat = position.coords.latitude;
          currentLon = position.coords.longitude;
        } else {
          let { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            currentLat = location.coords.latitude;
            currentLon = location.coords.longitude;
          }
        }
      } catch (locErr) {}

      // Insert attendance record into secondary database table
      const { error: insertErr } = await attendanceClient
        .from(subOrgAttendanceTable)
        .insert([
          {
            event_id: scannedData.eventId,
            student_id: profile.id,
            proof_photo_url: publicUrl,
            latitude: currentLat,
            longitude: currentLon,
            status: 'present',
            time_in: new Date().toISOString(),
          }
        ]);

      if (insertErr) throw new Error(insertErr.message || 'Failed to record sub-org attendance.');

      Alert.alert(`${chapterCode} Attendance Verified!`, 'Your chapter presence has been recorded.');
      if (onScanComplete) onScanComplete();
      onClose();
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not process sub-org attendance.');
      setStep('SELFIE');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} statusBarTranslucent={true} onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.fullScreenContainer}>
        {Platform.OS === 'web' ? (
          <View style={styles.webContainer}>
            <View style={styles.topBar}>
              <View style={styles.headerBadge}><Text style={styles.headerTitle}>{chapterCode} CHAPTER SCANNER</Text></View>
              <TouchableOpacity onPress={() => { stopWebcam(); onClose(); }} style={styles.closeBtn}><Ionicons name="close" size={24} color="#ffffff" /></TouchableOpacity>
            </View>
            {step === 'SCAN' && (
              <View style={styles.webScannerCard}>
                <Text style={styles.webInstructionText}>Align {chapterCode} QR Code</Text>
                <div id="web-suborg-qr-container" style={{ width: '100%', borderRadius: '16px', overflow: 'hidden', background: '#000' }} />
              </View>
            )}
            {step === 'SELFIE' && (
              <View style={styles.webSelfieWrapper}>
                <Text style={styles.selfieGuideText}>Take attendance selfie</Text>
                <div style={{ width: '100%', maxWidth: '320px', aspectRatio: '3/4', background: '#000', borderRadius: '24px', overflow: 'hidden', margin: '16px 0' }}>
                  <video ref={webVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  <canvas ref={webCanvasRef} style={{ display: 'none' }} />
                </div>
                <TouchableOpacity onPress={handleTakeSelfie} style={styles.shutterBtn}><View style={styles.shutterInner} /></TouchableOpacity>
              </View>
            )}
            {step === 'UPLOADING' && <View style={styles.uploadingContainer}><ActivityIndicator size="large" color="#ffffff" /><Text style={styles.uploadingText}>Verifying {chapterCode}...</Text></View>}
          </View>
        ) : (
          <View style={StyleSheet.absoluteFillObject}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing={facing} barcodeScannerSettings={step === 'SCAN' ? { barcodeTypes: ['qr'] } : undefined} onBarcodeScanned={step === 'SCAN' ? handleBarcodeScanned : undefined} />
            <View style={styles.overlay} pointerEvents="box-none">
              <View style={styles.topBar}>
                <View style={styles.headerBadge}><Text style={styles.headerTitle}>{chapterCode} CHAPTER SCANNER</Text></View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Ionicons name="close" size={24} color="#ffffff" /></TouchableOpacity>
              </View>
              {step === 'SCAN' && (
                <View style={styles.centerTargetContainer} pointerEvents="none">
                  <View style={styles.guideBox}>
                    <View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /><View style={styles.laserLine} />
                  </View>
                  <Text style={styles.guideText}>Align {chapterCode} QR Code</Text>
                </View>
              )}
              {step === 'SELFIE' && (
                <View style={styles.bottomSelfieContainer}>
                  <Text style={styles.selfieGuideText}>Take attendance selfie</Text>
                  <TouchableOpacity onPress={handleTakeSelfie} style={styles.shutterBtn}><View style={styles.shutterInner} /></TouchableOpacity>
                </View>
              )}
              {step === 'UPLOADING' && <View style={styles.uploadingContainer}><ActivityIndicator size="large" color="#ffffff" /><Text style={styles.uploadingText}>Verifying {chapterCode}...</Text></View>}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullScreenContainer: { flex: 1, width, height, backgroundColor: '#000000' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', zIndex: 10 },
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 40, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 50 },
  headerBadge: { backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.2)' },
  headerTitle: { color: '#ffffff', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0, 0, 0, 0.65)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.2)' },
  centerTargetContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 20 },
  guideBox: { width: width * 0.72, height: width * 0.72, borderRadius: 24, position: 'relative', justifyContent: 'center', alignItems: 'center' },
  laserLine: { width: '90%', height: 2, backgroundColor: '#854d0e', shadowColor: '#b45309', shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: '#ffffff' },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 20 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 20 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 20 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 20 },
  guideText: { color: '#ffffff', fontSize: 12, fontWeight: '700', marginTop: 22, backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 14, borderWidth: 1 },
  bottomSelfieContainer: { position: 'absolute', bottom: Platform.OS === 'ios' ? 50 : 36, left: 0, right: 0, zIndex: 50 },
  selfieGuideText: { color: '#ffffff', fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 20, backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14 },
  shutterBtn: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#ffffff', justifyContent: 'center', alignItems: 'center', alignSelf: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#854d0e' },
  uploadingContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.75)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  webContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center', padding: 20 },
  webScannerCard: { width: '100%', maxWidth: '380px', backgroundColor: '#111827', borderRadius: 28, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  webSelfieWrapper: { alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: '380px', backgroundColor: '#111827', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  webInstructionText: { color: '#ffffff', fontSize: 12, fontWeight: '700', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 },
  uploadingText: { color: '#ffffff', fontSize: 12, fontWeight: '800', marginTop: 14, textTransform: 'uppercase', letterSpacing: 1 },
});
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';

const fcoLogo = require('../../assets/FCO-LOGOO.png');

export default function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleanId = username.trim();
    const cleanPw = password.trim();

    if (!cleanId || !cleanPw) {
      Alert.alert('Required Fields', 'Please enter both your Student Number and Password.');
      return;
    }

    try {
      setLoading(true);

      // Call our direct, secure student authentication RPC
      const { data: res, error: rpcErr } = await supabase.rpc('student_authenticate', {
        p_identifier: cleanId,
        p_password: cleanPw,
      });

      if (rpcErr) {
        Alert.alert('Connection Error', rpcErr.message || 'Unable to connect to server.');
        return;
      }

      if (!res || !res.success) {
        Alert.alert('Login Failed', res?.message || 'Incorrect Student Number or Password.');
        return;
      }

      // Success! Pass profile back to App.jsx
      if (onLoginSuccess) {
        onLoginSuccess(res.profile);
      }
    } catch (err) {
      Alert.alert('Login Error', err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const WrapperComponent = Platform.OS === 'web' ? View : TouchableWithoutFeedback;
  const wrapperProps = Platform.OS === 'web' ? {} : { onPress: Keyboard.dismiss };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <WrapperComponent {...wrapperProps}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

          <View style={styles.headerContainer}>
            <Image
              source={fcoLogo}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appName}>ATENDER APP</Text>
            <Text style={styles.tagline}>
              Scan. Snap. Attend.
            </Text>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.welcomeText}>LOGIN TO YOUR ACCOUNT</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Student Number</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 23-12345"
                placeholderTextColor="#94a3b8"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Enter your password"
                  placeholderTextColor="#94a3b8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => setShowPassword(!showPassword)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.loginButtonText}>LOGIN</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Watermark Section (Stacked) */}
          <View style={styles.watermarkContainer}>
            <Text style={styles.watermarkLabel}>Developed by</Text>
            <Text style={styles.watermarkBrand}>BrainnnerrDev</Text>
          </View>

        </ScrollView>
      </WrapperComponent>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  headerContainer: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 110, height: 110, marginBottom: 14 },
  appName: { fontSize: 24, fontWeight: '900', color: '#8b0000', letterSpacing: 2.5, marginBottom: 4 },
  tagline: { fontSize: 12, fontWeight: '600', color: '#64748b', textAlign: 'center', letterSpacing: 0.4 },
  formContainer: { width: '100%' },
  welcomeText: { fontSize: 14, fontWeight: '800', color: '#1e293b', marginBottom: 20, textAlign: 'center', letterSpacing: 0.5, textTransform: 'uppercase' },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { height: 50, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16, fontSize: 14, color: '#0f172a' },
  passwordWrapper: { flexDirection: 'row', alignItems: 'center', height: 50, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16 },
  passwordInput: { flex: 1, height: '100%', fontSize: 14, color: '#0f172a', outlineStyle: 'none' },
  toggleButton: { paddingLeft: 10, paddingVertical: 4 },
  loginButton: { height: 52, backgroundColor: '#8b0000', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12, shadowColor: '#8b0000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4 },
  loginButtonDisabled: { opacity: 0.7 },
  loginButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  
  // Watermark Styles (Stacked layout)
  watermarkContainer: { alignItems: 'center', marginTop: 36 },
  watermarkLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.5, marginBottom: 2 },
  watermarkBrand: { fontSize: 12, fontWeight: '900', color: '#8b0000', letterSpacing: 0.8 },
});
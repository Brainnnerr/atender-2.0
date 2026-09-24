import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';

export default function Login({ onLogin, showToast }) {
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoggingIn(true);
    
    try {
      // Linisin ang input para tanggalin ang extra spaces sa unahan at hulihan
      const emailTrim = (adminEmail || '').trim().toLowerCase();
      const passTrim = (adminPassword || '').trim();

      let matchedRole = null;

      // Hard-coded credentials check na may case-insensitive handling para sa email
      if (emailTrim === 'fcocoe92@gmail.com' && passTrim === '_BRAINER12345') {
        matchedRole = 'fco';
      } else if (emailTrim === 'iiee.admin@scanner.com' && passTrim === 'iieeadmin123') {
        matchedRole = 'iiee';
      } else if (emailTrim === 'pice.admin@scanner.com' && passTrim === 'piceadmin123') {
        matchedRole = 'pice';
      }

      if (!matchedRole) {
        throw new Error('Invalid email or password.');
      }

      const sessionData = {
        user: {
          email: emailTrim,
          role: matchedRole
        }
      };

      // I-save sa localStorage para hindi ma-logout pagka-refresh
      localStorage.setItem('atender_admin_session', JSON.stringify(sessionData));
      
      showToast(`Successfully logged in as ${matchedRole.toUpperCase()} Admin!`, 'success');
      onLogin(sessionData);

    } catch (err) {
      console.error("Login Error:", err);
      showToast(err.message || 'Invalid email or password.', 'error');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ backgroundColor: '#ffffff', padding: '36px', borderRadius: '20px', maxWidth: '400px', width: '100%', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '54px', height: '54px', borderRadius: '16px', backgroundColor: '#8b0000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', marginBottom: '12px', boxShadow: '0 4px 12px rgba(139, 0, 0, 0.2)' }}>
            <ShieldCheck size={30} />
          </div>
          <h1 style={{ fontSize: '18px', fontWeight: '900', textTransform: 'uppercase', color: '#0f172a', margin: 0 }}>Atender Admin Portal</h1>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Sign in to access your organization scanner</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Admin Email</label>
            <input 
              type="text" 
              required 
              value={adminEmail} 
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="e.g. fcoco92@gmail.com"
              style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                value={adminPassword} 
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', padding: '12px 40px 12px 12px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button 
            type="submit" 
            disabled={loggingIn}
            style={{ backgroundColor: '#8b0000', color: '#ffffff', padding: '14px', borderRadius: '12px', fontWeight: '900', fontSize: '12px', textTransform: 'uppercase', border: 'none', cursor: 'pointer', marginTop: '8px', boxShadow: '0 4px 12px rgba(139, 0, 0, 0.25)' }}
          >
            {loggingIn ? 'Authenticating...' : 'Sign In to Scanner'}
          </button>
        </form>
      </div>
    </div>
  );
}
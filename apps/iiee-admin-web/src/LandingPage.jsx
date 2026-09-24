import React, { useState } from 'react';
import { supabase } from './services/supabase';

export default function LandingPage({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      // 1. Dynamically locate the IIEE organization ID from the database
      const { data: orgData, error: orgErr } = await supabase
        .from('organizations')
        .select('id')
        .ilike('name', '%Electrical%')
        .maybeSingle();

      if (orgErr || !orgData) {
        setErrorMsg('IIEE Organization profile not configured in database.');
        setLoading(false);
        return;
      }

      // 2. Query admin_accounts matching the organization and inputs
      const { data, error } = await supabase
        .from('admin_accounts')
        .select('*')
        .eq('organization_id', orgData.id)
        .eq('email', email.trim())
        .eq('password', password)
        .maybeSingle();

      if (error || !data) {
        setErrorMsg('Invalid email or password for IIEE Admin.');
      } else {
        onLoginSuccess(data);
      }
    } catch (err) {
      console.error('Login exception:', err);
      setErrorMsg('An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        body, html {
          margin: 0;
          padding: 0;
          width: 100%;
          min-height: 100%;
        }
        
        .landing-container {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 80px;
          box-sizing: border-box;
          background: linear-gradient(rgba(30, 20, 5, 0.7), rgba(15, 10, 2, 0.8)), url("/COE-PIC.jpg") center center / cover no-repeat fixed;
          font-family: sans-serif;
        }
        
        .landing-brand {
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-width: 500px;
        }
        
        .landing-card {
          width: 420px;
          background-color: #ffffff;
          padding: 40px;
          border-radius: 24px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
        }
        
        @media (max-width: 900px) {
          .landing-container {
            flex-direction: column;
            justify-content: center;
            gap: 40px;
            padding: 40px 20px;
          }
          .landing-brand {
            align-items: center;
            text-align: center;
            max-width: 100%;
          }
          .landing-card {
            width: 100%;
            max-width: 420px;
            padding: 30px 20px;
          }
        }
      `}</style>

      <div className="landing-container">
        {/* Left Branding Section */}
        <div className="landing-brand">
          <img src="/IIEE-BG.png" alt="IIEE Logo" style={{ width: '96px', height: '96px', borderRadius: '50%', border: '3px solid #fde047', boxShadow: '0 6px 16px rgba(0,0,0,0.5)', objectFit: 'cover' }} />
          <div>
            <h1 style={{ fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: '900', color: '#ffffff', margin: 0, lineHeight: '1.1', letterSpacing: '1px' }}>ATENDER</h1>
            <h1 style={{ fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: '900', color: '#fde047', margin: 0, lineHeight: '1.1', letterSpacing: '1px' }}>SYSTEM</h1>
          </div>
          <p style={{ fontSize: '13px', fontWeight: '900', color: '#fef08a', letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: '8px' }}>
            IIEE - ESSU 
          </p>
        </div>

        {/* Right Login Card */}
        <div className="landing-card">
          <div style={{ fontSize: '11px', fontWeight: '900', color: '#854d0e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
            Administrator Access
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', margin: '0 0 8px 0' }}>
            Sign In to Dashboard
          </h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '28px' }}>
            Enter your administrative credentials to continue.
          </p>

          {errorMsg && (
            <div style={{ backgroundColor: '#fef2f2', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', marginBottom: '20px' }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Email</label>
              <input 
                type="email" 
                required 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="user@gmail.com" 
                style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }} 
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Password</label>
              </div>
              <div style={{ position: 'relative' }}>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  required 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="••••••••" 
                  style={{ width: '100%', padding: '12px 40px 12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }} 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)} 
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#854d0e', fontWeight: '900', fontSize: '11px' }}
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              style={{ backgroundColor: '#854d0e', color: '#ffffff', padding: '14px', borderRadius: '10px', fontWeight: '900', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', marginTop: '10px', boxShadow: '0 4px 6px rgba(133, 77, 14, 0.3)' }}
            >
              {loading ? 'Authenticating...' : 'Access Dashboard'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '10px', fontWeight: '800', color: '#94a3b8', letterSpacing: '1px' }}>
            ATENDER IIEE CONSOLE
          </div>
        </div>
      </div>
    </>
  );
}
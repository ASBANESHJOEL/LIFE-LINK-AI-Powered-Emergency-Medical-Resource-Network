import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, ShieldCheck, ArrowRight, RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export function LoginPage() {
  const { signInWithOtp, verifyOtp, user, role, profileStatus, authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('EMAIL'); // 'EMAIL' | 'OTP'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Redirect if already logged in and active
  useEffect(() => {
    if (user && role && profileStatus === 'ACTIVE') {
      const rolePaths = {
        DONOR: '/donor',
        HOSPITAL: '/hospital',
        BLOOD_BANK: '/blood-bank',
        ADMIN: '/admin'
      };
      const dest = location.state?.from?.pathname || rolePaths[role] || '/unauthorized';
      navigate(dest, { replace: true });
    } else if (user && profileStatus === 'UNPROVISIONED') {
      navigate('/unprovisioned', { replace: true });
    } else if (user && profileStatus === 'INACTIVE') {
      navigate('/inactive', { replace: true });
    }
  }, [user, role, profileStatus, navigate, location]);

  // Handle resend cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Request Email OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      await signInWithOtp(trimmedEmail);
      setStep('OTP');
      setMessage(`Verification code dispatched to ${trimmedEmail}`);
      setCooldown(60);
    } catch (err) {
      console.error('Sign-in OTP request failed:', err);
      setError(err.message || 'Failed to send verification code. Please verify the email is provisioned.');
    } finally {
      setLoading(false);
    }
  };

  // Verify Email OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    const trimmedOtp = otp.trim();
    if (!trimmedOtp || trimmedOtp.length !== 8) {
      setError('Please enter the 8-digit verification code.');
      return;
    }

    try {
      setLoading(true);
      await verifyOtp(email.trim().toLowerCase(), trimmedOtp);
      // AuthContext onAuthStateChange will trigger profile lookup and redirect
    } catch (err) {
      console.error('OTP verification failed:', err);
      setError(err.message || 'Invalid or expired verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return;
    setError('');
    try {
      setLoading(true);
      await signInWithOtp(email.trim().toLowerCase());
      setMessage(`A fresh verification code was sent to ${email}`);
      setCooldown(60);
    } catch (err) {
      setError(err.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '36px' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.2) 0%, rgba(220, 38, 38, 0.05) 100%)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto'
            }}
          >
            <ShieldCheck size={30} color="#ef4444" />
          </div>
          <h1 style={{ fontSize: '1.6rem', marginBottom: '6px' }}>LIFE-LINK</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Emergency Medical Resource Network
          </p>
        </div>

        {/* Feedback Alerts */}
        {(error || (profileStatus === 'ERROR' && authError)) && (
          <div className="alert alert-error">
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>{error || authError}</div>
          </div>
        )}

        {message && (
          <div className="alert alert-success">
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>{message}</div>
          </div>
        )}

        {/* STEP 1: Enter Email */}
        {step === 'EMAIL' ? (
          <form onSubmit={handleRequestOtp}>
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Authorized Organization or Donor Email
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="name@hospital.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '8px' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="spinner" />
                  <span>Requesting Code...</span>
                </>
              ) : (
                <>
                  <span>Send Verification Code</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            <div style={{ marginTop: '24px', textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                Protected by Supabase Auth passwordless OTP.
                <br />
                Only provisioned credentials can authenticate.
              </p>
            </div>
          </form>
        ) : (
          /* STEP 2: Enter OTP */
          <form onSubmit={handleVerifyOtp}>
            <div className="form-group" style={{ textAlign: 'center' }}>
              <label htmlFor="otp" className="form-label">
                Verification Code
              </label>
              <input
                id="otp"
                type="text"
                className="form-input"
                style={{
                  textAlign: 'center',
                  fontSize: '1.6rem',
                  letterSpacing: '0.3em',
                  fontWeight: '700'
                }}
                maxLength={8}
                placeholder="••••••••"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '8px' }}
              disabled={loading || otp.trim().length !== 8}
            >
              {loading ? (
                <>
                  <div className="spinner" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <span>Verify & Access Network</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '20px'
              }}
            >
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setStep('EMAIL');
                  setOtp('');
                  setError('');
                }}
                disabled={loading}
              >
                ← Change Email
              </button>

              <button
                type="button"
                className="btn-text"
                onClick={handleResendOtp}
                disabled={cooldown > 0 || loading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <RotateCw size={14} />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

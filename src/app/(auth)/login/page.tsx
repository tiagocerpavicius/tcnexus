'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = '/dashboard';
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('Cuenta creada. Ya podés iniciar sesión.');
        setMode('login');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      setError(msg === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '20px',
      background: 'radial-gradient(ellipse at top, #13132a 0%, var(--bg) 60%)',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            marginBottom: '8px',
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'var(--violet)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Syne, sans-serif', fontWeight: 800,
              fontSize: '16px', color: '#fff',
            }}>TC</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', color: 'var(--text)' }}>
              NEXUS
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.1em' }}>
            INVERSIONES · ANÁLISIS · CONTROL
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '32px' }}>
          {/* Toggle */}
          <div style={{
            display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: '10px', padding: '4px', marginBottom: '28px',
          }}>
            {(['login', 'register'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                flex: 1, padding: '9px', background: mode === m ? 'var(--violet)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--muted2)', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                fontWeight: 700, fontSize: '12px', letterSpacing: '0.06em',
                textTransform: 'uppercase', transition: 'all 0.15s',
              }}>
                {m === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div className="label-xs" style={{ marginBottom: '6px' }}>Email</div>
              <input className="input-field" type="email" placeholder="tu@email.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <div className="label-xs" style={{ marginBottom: '6px' }}>Contraseña</div>
              <input className="input-field" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>

            {error && (
              <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: 'var(--red)' }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: 'var(--green)' }}>
                {success}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: '4px', padding: '12px' }}>
              {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

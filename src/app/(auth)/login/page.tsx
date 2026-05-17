'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const particles = [
  { text: '+2.34%', x: 8, y: 15, delay: 0, dur: 8 },
  { text: 'AAPL', x: 82, y: 22, delay: 1, dur: 10 },
  { text: '↑ YPFD', x: 22, y: 68, delay: 2, dur: 9 },
  { text: 'MEP $1.235', x: 68, y: 78, delay: 0.5, dur: 12 },
  { text: '-1.2%', x: 12, y: 44, delay: 3, dur: 7 },
  { text: 'BTC 91k', x: 88, y: 52, delay: 1.5, dur: 11 },
  { text: 'AL30', x: 48, y: 88, delay: 2.5, dur: 8 },
  { text: 'S&P +0.8%', x: 38, y: 8, delay: 0.8, dur: 13 },
  { text: 'CEDEAR', x: 62, y: 32, delay: 3.5, dur: 9 },
  { text: 'GD35', x: 75, y: 62, delay: 1.2, dur: 10 },
  { text: '+4.1%', x: 92, y: 38, delay: 2.2, dur: 8 },
  { text: 'ON YPF', x: 5, y: 82, delay: 4, dur: 11 },
];

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

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
    <>
      <style>{`
        @keyframes float {
          0%,100% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 0.35; }
          90% { opacity: 0.35; }
          50% { transform: translateY(-28px) translateX(12px); }
        }
        @keyframes orb1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33% { transform: translate(60px,-40px) scale(1.1); }
          66% { transform: translate(-40px,30px) scale(0.92); }
        }
        @keyframes orb2 {
          0%,100% { transform: translate(0,0) scale(1); }
          33% { transform: translate(-50px,50px) scale(1.15); }
          66% { transform: translate(70px,-20px) scale(0.88); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes logoIn {
          from { opacity: 0; transform: scale(0.92) translateY(-8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 20px rgba(124,58,237,0.35); }
          50% { box-shadow: 0 0 40px rgba(124,58,237,0.6); }
        }
      `}</style>

      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '20px',
        background: 'var(--bg)', overflow: 'hidden', position: 'relative',
      }}>

        {/* Orbs de fondo */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', width: '650px', height: '650px',
            borderRadius: '50%', left: '-120px', top: '-180px',
            background: 'radial-gradient(circle, rgba(124,58,237,0.14) 0%, transparent 70%)',
            animation: 'orb1 16s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', width: '550px', height: '550px',
            borderRadius: '50%', right: '-100px', bottom: '-120px',
            background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)',
            animation: 'orb2 20s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', width: '400px', height: '400px',
            borderRadius: '50%', left: '42%', top: '28%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.06) 0%, transparent 70%)',
            animation: 'orb1 25s ease-in-out infinite reverse',
          }} />
        </div>

        {/* Partículas financieras flotantes */}
        {mounted && particles.map((p, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            fontFamily: 'DM Mono, monospace', fontSize: '11px',
            color: 'rgba(124,58,237,0.3)',
            animation: `float ${p.dur}s ${p.delay}s ease-in-out infinite`,
            pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
          }}>{p.text}</div>
        ))}

        {/* Contenido */}
        <div style={{ width: '100%', maxWidth: '400px', position: 'relative', zIndex: 1 }}>

          {/* Logo */}
          <div style={{
            textAlign: 'center', marginBottom: '40px',
            animation: mounted ? 'logoIn 0.6s ease forwards' : 'none',
          }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <div style={{
                width: '46px', height: '46px', borderRadius: '12px',
                background: 'var(--violet)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Syne, sans-serif', fontWeight: 800,
                fontSize: '16px', color: '#fff',
                animation: 'pulse 3s ease-in-out infinite',
              }}>TC</div>
              <div style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 800,
                fontSize: '28px', color: 'var(--text)', letterSpacing: '0.06em',
              }}>NEXUS</div>
            </div>
            <div style={{
              fontSize: '11px', color: 'var(--muted2)',
              fontFamily: 'DM Mono, monospace', letterSpacing: '0.12em',
            }}>INVERSIONES · ANÁLISIS · CONTROL</div>
          </div>

          {/* Card */}
          <div style={{
            background: 'rgba(13,13,28,0.9)', border: '1px solid var(--border)',
            borderRadius: '16px', padding: '32px',
            backdropFilter: 'blur(12px)',
            animation: mounted ? 'slideUp 0.5s 0.15s ease both' : 'none',
          }}>
            {/* Toggle */}
            <div style={{
              display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '4px', marginBottom: '28px',
            }}>
              {(['login', 'register'] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                  flex: 1, padding: '9px',
                  background: mode === m ? 'var(--violet)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--muted2)',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700,
                  fontSize: '12px', letterSpacing: '0.06em',
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
                <div style={{
                  background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
                  borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: 'var(--red)',
                }}>{error}</div>
              )}
              {success && (
                <div style={{
                  background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: 'var(--green)',
                }}>{success}</div>
              )}

              <button className="btn-primary" type="submit" disabled={loading}
                style={{ marginTop: '4px', padding: '13px' }}>
                {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

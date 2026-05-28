'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/useIsMobile';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)',
      }}>
        <div style={{
          fontFamily: 'Syne, sans-serif', fontSize: '13px',
          color: 'var(--muted)', letterSpacing: '0.1em',
        }}>TCNEXUS</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {!isMobile && (
        <Sidebar
          userEmail={user.email || ''}
          onSignOut={signOut}
          collapsed={collapsed}
          onToggle={() => setCollapsed(c => !c)}
        />
      )}
      <main style={{
        marginLeft: isMobile ? 0 : (collapsed ? 64 : 240),
        flex: 1,
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: isMobile ? '16px 14px 76px 14px' : '32px',
        transition: 'margin-left 0.2s ease',
        maxWidth: '100vw',
        overflowX: 'hidden',
      }}>
        {children}
      </main>
      {isMobile && <BottomNav onSignOut={signOut} />}
    </div>
  );
}

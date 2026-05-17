'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
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

  const sidebarWidth = collapsed ? 64 : 240;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        userEmail={user.email || ''}
        onSignOut={signOut}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      <main style={{
        marginLeft: sidebarWidth,
        flex: 1,
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '32px',
        transition: 'margin-left 0.2s ease',
      }}>
        {children}
      </main>
    </div>
  );
}

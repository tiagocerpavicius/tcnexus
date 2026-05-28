'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, PieChart, TrendingUp, Newspaper,
  RefreshCw, BarChart2, Upload, LogOut
} from 'lucide-react';

const navItems = [
  { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/portfolio',  icon: PieChart,         label: 'Portfolio' },
  { href: '/mercado',    icon: TrendingUp,        label: 'Mercado'  },
  { href: '/cauciones',  icon: RefreshCw,         label: 'Cauciones'},
  { href: '/reportes',   icon: BarChart2,         label: 'Reportes' },
];

export default function BottomNav({ onSignOut }: { onSignOut: () => void }) {
  const pathname = usePathname();
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: '60px', background: 'var(--surface)',
      borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-around', zIndex: 200,
      backdropFilter: 'blur(16px)',
    }}>
      {navItems.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link key={href} href={href} style={{ textDecoration: 'none', flex: 1 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', padding: '6px 4px',
              color: active ? 'var(--violet-light)' : 'var(--muted)',
              transition: 'color 0.15s',
            }}>
              <Icon size={19} strokeWidth={active ? 2 : 1.5} />
              <span style={{
                fontSize: '9px', fontFamily: 'Syne, sans-serif',
                fontWeight: active ? 700 : 500, letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}>{label}</span>
              {active && (
                <div style={{
                  width: '4px', height: '4px', borderRadius: '50%',
                  background: 'var(--violet)', marginTop: '1px',
                }} />
              )}
            </div>
          </Link>
        );
      })}
      <button onClick={onSignOut} style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '3px', padding: '6px 4px', background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--muted)',
      }}>
        <LogOut size={19} strokeWidth={1.5} />
        <span style={{
          fontSize: '9px', fontFamily: 'Syne, sans-serif',
          fontWeight: 500, letterSpacing: '0.04em',
        }}>Salir</span>
      </button>
    </nav>
  );
}

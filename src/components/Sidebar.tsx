'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, PieChart, TrendingUp, Newspaper,
  RefreshCw, BarChart2, Upload, LogOut, ChevronLeft, ChevronRight
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/portfolio', icon: PieChart, label: 'Portfolio' },
  { href: '/mercado', icon: TrendingUp, label: 'Mercado' },
  { href: '/noticias', icon: Newspaper, label: 'Noticias' },
  { href: '/cauciones', icon: RefreshCw, label: 'Cauciones' },
  { href: '/reportes', icon: BarChart2, label: 'Reportes' },
  { href: '/importar', icon: Upload, label: 'Importar' },
];

interface SidebarProps {
  userEmail: string;
  onSignOut: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ userEmail, onSignOut, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div style={{
      width: collapsed ? 64 : 240,
      minHeight: '100vh',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', left: 0, top: 0, bottom: 0,
      transition: 'width 0.2s ease',
      zIndex: 100, overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{
        padding: collapsed ? '16px 0' : '16px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        minHeight: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'var(--violet)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontFamily: 'Syne, sans-serif',
            fontWeight: 800, fontSize: '12px', color: '#fff', flexShrink: 0,
          }}>TC</div>
          {!collapsed && (
            <span style={{
              fontFamily: 'Syne, sans-serif', fontWeight: 800,
              fontSize: '16px', color: 'var(--text)',
              letterSpacing: '0.06em', whiteSpace: 'nowrap',
            }}>NEXUS</span>
          )}
        </div>
        {!collapsed && (
          <button onClick={onToggle} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: '4px', borderRadius: '6px',
            display: 'flex', alignItems: 'center',
          }}>
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 0', overflowX: 'hidden' }}>
        {navItems.map(item => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: collapsed ? '11px 0' : '10px 14px',
              margin: '1px 8px', borderRadius: '8px',
              textDecoration: 'none',
              background: isActive ? 'rgba(124,58,237,0.12)' : 'transparent',
              color: isActive ? 'var(--violet-light)' : 'var(--text2)',
              transition: 'all 0.15s',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderLeft: isActive ? '2px solid var(--violet)' : '2px solid transparent',
            }}>
              <Icon size={17} strokeWidth={isActive ? 2 : 1.5} />
              {!collapsed && (
                <span style={{
                  fontFamily: 'DM Sans, sans-serif', fontSize: '14px',
                  fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap',
                }}>{item.label}</span>
              )}
            </Link>
          );
        })}

        {collapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
            <button onClick={onToggle} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--muted2)', padding: '7px',
              borderRadius: '8px', display: 'flex', alignItems: 'center',
            }}>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </nav>

      {/* Usuario */}
      <div style={{
        padding: collapsed ? '12px 0' : '14px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '10px',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label-xs" style={{ marginBottom: '2px' }}>Cuenta</div>
            <div style={{
              fontSize: '11px', color: 'var(--text2)',
              fontFamily: 'DM Mono, monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{userEmail}</div>
          </div>
        )}
        <button onClick={onSignOut} title="Cerrar sesión" style={{
          background: 'var(--surface2)', border: '1px solid var(--border)',
          cursor: 'pointer', color: 'var(--muted2)', padding: '7px',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          flexShrink: 0,
        }}>
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

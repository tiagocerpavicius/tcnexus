'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, RefreshCw, Check, X, ChevronRight, ChevronDown, Pencil, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';

type Moneda = 'ARS' | 'USD';

interface Caucion {
  id: string; descripcion: string; monto: number; tna: number;
  plazo: number; fechaInicio: string; renovaciones: number; moneda: Moneda;
}
interface CaucionPeriodo {
  id: string; caucionId: string; monto: number; tna: number;
  plazo: number; fechaInicio: string; intereses: number;
}
interface Activo {
  id: string; ticker: string; tipo: string; cantidad: number;
  precioCompra: number; precioActual: number;
  precioVenta?: number; fechaVenta?: string; moneda: Moneda;
}

function calcVencimiento(fechaInicio: string, plazo: number): string {
  const d = new Date(fechaInicio + 'T00:00:00');
  d.setDate(d.getDate() + plazo);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function calcVencimientoISO(fechaInicio: string, plazo: number): string {
  const d = new Date(fechaInicio + 'T00:00:00');
  d.setDate(d.getDate() + plazo);
  return d.toISOString().split('T')[0];
}
function calcDiasRestantes(fechaInicio: string, plazo: number): number {
  const venc = new Date(fechaInicio + 'T00:00:00');
  venc.setDate(venc.getDate() + plazo);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.ceil((venc.getTime() - hoy.getTime()) / 86400000);
}
function calcInteresPeriodo(monto: number, tna: number, plazo: number): number {
  return monto * (tna / 100) * (plazo / 365);
}
function calcTEA(tna: number, plazo: number): number {
  return (Math.pow(1 + (tna / 100) * (plazo / 365), 365 / plazo) - 1) * 100;
}
function calcPnL(precioCompra: number, precioActual: number, cantidad: number): number {
  return (precioActual - precioCompra) * cantidad;
}
function calcPnLPct(precioCompra: number, precioActual: number): number {
  return precioCompra > 0 ? ((precioActual - precioCompra) / precioCompra) * 100 : 0;
}

const fmtM = (n: number, moneda: Moneda, dec = 2): string => {
  const abs = Math.abs(n); const sign = n < 0 ? '-' : '';
  const str = moneda === 'USD'
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(abs)
    : new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(abs);
  return `${sign}$${str}`;
};
const fmtPct = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtNum = (n: number, dec = 2): string => new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

const genId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2);

function rowToCaucion(r: any): Caucion {
  return { id: r.id, descripcion: r.descripcion || '', monto: r.monto, tna: r.tna, plazo: r.plazo, fechaInicio: r.fecha_inicio, renovaciones: r.renovaciones ?? 0, moneda: r.moneda || 'USD' };
}
function rowToPeriodo(r: any): CaucionPeriodo {
  return { id: r.id, caucionId: r.caucion_id, monto: r.monto, tna: r.tna, plazo: r.plazo, fechaInicio: r.fecha_inicio, intereses: r.intereses };
}
function rowToActivo(r: any): Activo {
  return { id: r.id, ticker: r.ticker, tipo: r.tipo || 'cedear', cantidad: r.cantidad, precioCompra: r.precio_compra, precioActual: r.precio_actual, precioVenta: r.precio_venta ?? undefined, fechaVenta: r.fecha_venta ?? undefined, moneda: r.moneda || 'USD' };
}

const TIPO_ACTIVO_OPTS = [
  { value: 'cedear', label: 'CEDEAR' },
  { value: 'lecap', label: 'LECAP' },
  { value: 'bono', label: 'Bono Soberano' },
  { value: 'on', label: 'ON' },
  { value: 'accion_ar', label: 'Acción AR' },
  { value: 'otro', label: 'Otro' },
];

// ─── Tab: Cauciones ───────────────────────────────────────────────────────────

function CaucionesTab({ cauciones, periodos, monedaActiva, onAdd, onRenovar, onDelete }: {
  cauciones: Caucion[]; periodos: Record<string, CaucionPeriodo[]>; monedaActiva: Moneda;
  onAdd: (d: Omit<Caucion, 'id' | 'renovaciones'>) => Promise<void>;
  onRenovar: (id: string, p: { monto: number; tna: number; plazo: number; fechaInicio: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const EMPTY = { descripcion: '', monto: '', tna: '', plazo: '', fechaInicio: new Date().toISOString().split('T')[0] };
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [renovando, setRenovando] = useState<string | null>(null);
  const [renovForm, setRenovForm] = useState({ monto: '', tna: '', plazo: '', fechaInicio: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.monto || !form.tna || !form.plazo) return;
    setSaving(true); await onAdd({ descripcion: form.descripcion, monto: Number(form.monto), tna: Number(form.tna), plazo: Number(form.plazo), fechaInicio: form.fechaInicio, moneda: monedaActiva });
    setForm(EMPTY); setSaving(false);
  };
  const startRenovar = (c: Caucion) => { setRenovando(c.id); setRenovForm({ monto: String(c.monto), tna: String(c.tna), plazo: String(c.plazo), fechaInicio: calcVencimientoISO(c.fechaInicio, c.plazo) }); };
  const confirmRenovar = async (id: string) => { if (!renovForm.monto || !renovForm.tna || !renovForm.plazo) return; await onRenovar(id, { monto: Number(renovForm.monto), tna: Number(renovForm.tna), plazo: Number(renovForm.plazo), fechaInicio: renovForm.fechaInicio }); setRenovando(null); };
  const toggleExpanded = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalMonto = cauciones.reduce((a, c) => a + c.monto, 0);
  const totalCosto = cauciones.reduce((a, c) => { const hist = (periodos[c.id] ?? []).reduce((s, p) => s + p.intereses, 0); return a + hist + calcInteresPeriodo(c.monto, c.tna, c.plazo); }, 0);
  const ls = { display: 'block' as const, marginBottom: '6px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>
          Nueva Caución <span style={{ color: monedaActiva === 'ARS' ? 'var(--amber)' : 'var(--green)', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>· {monedaActiva}</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}><label style={ls}>Descripción</label><input className="input-field" type="text" placeholder="Ej: Caución BYMA" value={form.descripcion} onChange={e => set('descripcion', e.target.value)} /></div>
            <div><label style={ls}>Monto ({monedaActiva})</label><input className="input-field" type="number" step="0.01" placeholder={monedaActiva === 'USD' ? '10000' : '10000000'} value={form.monto} onChange={e => set('monto', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>TNA (%)</label><input className="input-field" type="number" step="0.01" placeholder={monedaActiva === 'USD' ? '8.5' : '45'} value={form.tna} onChange={e => set('tna', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>Plazo (días)</label><input className="input-field" type="number" placeholder="7" value={form.plazo} onChange={e => set('plazo', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>Fecha inicio</label><input className="input-field" type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} /></div>
          </div>
          {form.monto && form.tna && form.plazo && (
            <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div><span style={{ fontSize: '11px', color: 'var(--muted)' }}>Interés: </span><span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--red)', fontSize: '12px' }}>{fmtM(calcInteresPeriodo(Number(form.monto), Number(form.tna), Number(form.plazo)), monedaActiva)}</span></div>
              <div><span style={{ fontSize: '11px', color: 'var(--muted)' }}>TEA: </span><span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--violet-light)', fontSize: '12px' }}>{calcTEA(Number(form.tna), Number(form.plazo)).toFixed(2)}%</span></div>
              <div><span style={{ fontSize: '11px', color: 'var(--muted)' }}>Venc.: </span><span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--text2)', fontSize: '12px' }}>{calcVencimiento(form.fechaInicio, Number(form.plazo))}</span></div>
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: '14px' }}>{saving ? 'Guardando...' : '+ Agregar Caución'}</button>
        </form>
      </div>

      {cauciones.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '10px' }}>
          {[
            { label: 'TOTAL TOMADO', value: fmtM(totalMonto, monedaActiva), color: 'var(--amber)' },
            { label: 'COSTO ACUMULADO', value: fmtM(totalCosto, monedaActiva), color: 'var(--red)' },
            { label: 'POSICIONES', value: `${cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) >= 0).length} vig. · ${cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) < 0).length} venc.`, color: 'var(--text)' },
          ].map(card => (
            <div key={card.label} className="card">
              <div className="label-xs" style={{ marginBottom: '8px' }}>{card.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', fontWeight: 600, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {cauciones.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '12px' : '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <th style={{ width: '32px', padding: '10px 8px' }} />
                  {['Descripción','Monto','TNA','Plazo','Vencimiento','Días', ...(isMobile ? [] : ['Renovac.','Int. período','Int. total']),'Estado',''].map((h, i) => (
                    <th key={i} style={{ padding: '10px 10px', textAlign: h === 'Descripción' ? 'left' : 'right', fontSize: '10px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--muted2)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cauciones.map(c => {
                  const dias = calcDiasRestantes(c.fechaInicio, c.plazo);
                  const vigente = dias >= 0;
                  const diasColor = dias < 0 ? 'var(--muted)' : dias < 2 ? 'var(--red)' : dias < 4 ? 'var(--amber)' : 'var(--text)';
                  const isRenovando = renovando === c.id;
                  const isExpanded = expanded.has(c.id);
                  const historial = periodos[c.id] ?? [];
                  const costoHist = historial.reduce((a, p) => a + p.intereses, 0);
                  const costoActual = calcInteresPeriodo(c.monto, c.tna, c.plazo);

                  return (
                    <>
                      <tr key={c.id} style={{ borderBottom: (isRenovando || isExpanded) ? 'none' : '1px solid var(--border)' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                          {historial.length > 0 && (<button onClick={() => toggleExpanded(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', padding: '2px', display: 'flex', alignItems: 'center' }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>)}
                        </td>
                        <td style={{ padding: '10px 10px', color: 'var(--text)', maxWidth: isMobile ? '80px' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion || '—'}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--amber)', fontWeight: 500 }}>{fmtM(c.monto, monedaActiva)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--violet-light)' }}>{c.tna.toFixed(2)}%</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{c.plazo}d</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)', fontSize: '11px' }}>{calcVencimiento(c.fechaInicio, c.plazo)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: diasColor, fontWeight: 600 }}>{dias}d</td>
                        {!isMobile && <>
                          <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{c.renovaciones === 0 ? '—' : `${c.renovaciones}x`}</td>
                          <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--red)' }}>{fmtM(costoActual, monedaActiva)}</td>
                          <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>{fmtM(costoHist + costoActual, monedaActiva)}</td>
                        </>}
                        <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                          <span style={{ fontSize: '9px', fontWeight: 700, fontFamily: 'Syne, sans-serif', padding: '2px 6px', borderRadius: '20px', background: vigente ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', color: vigente ? 'var(--green)' : 'var(--muted)', border: `1px solid ${vigente ? 'rgba(16,185,129,0.2)' : 'var(--border)'}` }}>
                            {vigente ? 'VIG' : 'VENC'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                            <button onClick={() => startRenovar(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isRenovando ? 'var(--violet-light)' : 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
                              onMouseOver={e => (e.currentTarget.style.color = 'var(--violet-light)')} onMouseOut={e => (e.currentTarget.style.color = isRenovando ? 'var(--violet-light)' : 'var(--muted)')}>
                              <RefreshCw size={13} />
                            </button>
                            {confirmDelete === c.id ? (
                              <div style={{ display: 'flex', gap: '3px' }}>
                                <button onClick={async () => { await onDelete(c.id); setConfirmDelete(null); }} style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Sí</button>
                                <button onClick={() => setConfirmDelete(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={11} /></button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDelete(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
                                onMouseOver={e => (e.currentTarget.style.color = 'var(--red)')} onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && historial.length > 0 && (
                        <tr key={`hist-${c.id}`} style={{ borderBottom: isRenovando ? 'none' : '1px solid var(--border)' }}>
                          <td colSpan={13} style={{ padding: '0 0 0 32px', background: 'rgba(0,0,0,0.15)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['Período','Monto','TNA','Plazo','Fecha inicio','Intereses'].map(h => (<th key={h} style={{ padding: '7px 10px', textAlign: h === 'Período' ? 'left' : 'right', fontSize: '9px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>))}</tr></thead>
                              <tbody>{historial.map((p, idx) => (<tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}><td style={{ padding: '7px 10px', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Período {idx + 1}</td><td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtM(p.monto, monedaActiva)}</td><td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{p.tna.toFixed(2)}%</td><td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{p.plazo}d</td><td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{p.fechaInicio}</td><td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--red)' }}>{fmtM(p.intereses, monedaActiva)}</td></tr>))}</tbody>
                            </table>
                          </td>
                        </tr>
                      )}

                      {isRenovando && (
                        <tr key={`renov-${c.id}`} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(124,58,237,0.04)' }}>
                          <td colSpan={13} style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--violet-light)', textTransform: 'uppercase' }}>Renovar</span>
                              {[{ label: 'Monto', field: 'monto' as const, w: '80px' }, { label: 'TNA %', field: 'tna' as const, w: '65px' }, { label: 'Plazo d', field: 'plazo' as const, w: '55px' }].map(({ label, field, w }) => (
                                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                  <span style={{ fontSize: '10px', color: 'var(--muted2)' }}>{label}</span>
                                  <input type="number" value={renovForm[field]} onChange={e => setRenovForm(p => ({ ...p, [field]: e.target.value }))}
                                    style={{ width: w, background: 'var(--surface2)', border: '1px solid var(--violet)', borderRadius: '6px', padding: '3px 6px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: '12px', textAlign: 'right' }} />
                                </div>
                              ))}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--muted2)' }}>Fecha</span>
                                <input type="date" value={renovForm.fechaInicio} onChange={e => setRenovForm(p => ({ ...p, fechaInicio: e.target.value }))}
                                  style={{ width: '125px', background: 'var(--surface2)', border: '1px solid var(--violet)', borderRadius: '6px', padding: '3px 6px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: '12px' }} />
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => confirmRenovar(c.id)} style={{ background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={11} /> OK</button>
                                <button onClick={() => setRenovando(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px', display: 'flex', alignItems: 'center' }}><X size={13} /></button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>📋</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--text)', marginBottom: '8px' }}>Sin cauciones en {monedaActiva}</div>
          <div style={{ fontSize: '13px', color: 'var(--muted2)' }}>Agregá una caución tomadora arriba.</div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Activos ─────────────────────────────────────────────────────────────

function ActivosTab({ activos, monedaActiva, onAdd, onUpdate, onDelete }: {
  activos: Activo[]; monedaActiva: Moneda;
  onAdd: (d: Omit<Activo, 'id'>) => Promise<void>;
  onUpdate: (id: string, d: Partial<Omit<Activo, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const EMPTY = { ticker: '', tipo: monedaActiva === 'USD' ? 'cedear' : 'lecap', cantidad: '', precioCompra: '', precioActual: '' };
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPrecio, setEditPrecio] = useState('');
  const [selling, setSelling] = useState<string | null>(null);
  const [sellData, setSellData] = useState({ precio: '', fecha: new Date().toISOString().split('T')[0] });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [mep, setMep] = useState(1430);

  useEffect(() => {
    fetch('/api/dolar').then(r => r.json()).then((data: any[]) => {
      if (Array.isArray(data)) { const bolsa = data.find(d => d.casa === 'bolsa'); if (bolsa?.venta) setMep(bolsa.venta); }
    }).catch(() => {});
  }, []);

  const abiertas = activos.filter(a => !a.precioVenta);
  const cerradas = activos.filter(a => a.precioVenta !== undefined);

  const autoRefreshRef = useRef(false);
  useEffect(() => {
    if (autoRefreshRef.current || abiertas.length === 0) return;
    autoRefreshRef.current = true;
    const t = setTimeout(() => handleRefresh(), 800);
    return () => clearTimeout(t);
  }, [abiertas.length]);

  useEffect(() => { setForm(p => ({ ...p, tipo: monedaActiva === 'USD' ? 'cedear' : 'lecap' })); }, [monedaActiva]);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.ticker || !form.cantidad || !form.precioCompra || !form.precioActual) return;
    setSaving(true); await onAdd({ ticker: form.ticker.toUpperCase(), tipo: form.tipo, cantidad: Number(form.cantidad), precioCompra: Number(form.precioCompra), precioActual: Number(form.precioActual), moneda: monedaActiva });
    setForm(EMPTY); setSaving(false);
  };

  const handleRefresh = async () => {
    if (!abiertas.length || refreshing) return;
    setRefreshing(true); setRefreshMsg('');
    try {
      const tickers = Array.from(new Set(abiertas.map(a => a.ticker)));
      let updated = 0;
      await Promise.all(tickers.map(async ticker => {
        try {
          const res = await fetch(`/api/buscar?ticker=${ticker}`);
          const data = await res.json();
          if (data.error) return;
          let precio: number | null = null;
          if (data.tipo === 'cedear') { const v = data.precio?.valor; const m = data.precio?.moneda; if (monedaActiva === 'ARS') precio = v ?? null; else precio = v ? (m === 'ARS' ? v / mep : v) : null; }
          else if (data.tipo === 'renta_variable') { const v = data.precio; const m = data.monedaLabel; if (monedaActiva === 'ARS') precio = v ?? null; else precio = v ? (m === 'ARS' ? v / mep : v) : null; }
          else if (data.tipo === 'renta_fija') { const v = data.precio?.valor; const m = data.monedaLabel; if (monedaActiva === 'ARS') precio = v ?? null; else precio = v ? (m === 'ARS' ? v / mep : v) : null; }
          if (precio != null) { for (const t of abiertas.filter(a => a.ticker === ticker)) { if (Math.abs(t.precioActual - precio!) > 0.0001) { await onUpdate(t.id, { precioActual: precio! }); updated++; } } }
        } catch {}
      }));
      setRefreshMsg(updated > 0 ? `✓ ${updated} precio${updated > 1 ? 's' : ''} actualizado${updated > 1 ? 's' : ''}` : '✓ Al día');
    } catch { setRefreshMsg('✗ Error'); }
    setRefreshing(false); setTimeout(() => setRefreshMsg(''), 4000);
  };

  const totalInvertido = abiertas.reduce((a, c) => a + c.precioCompra * c.cantidad, 0);
  const totalActual = abiertas.reduce((a, c) => a + c.precioActual * c.cantidad, 0);
  const pnlAbierto = totalActual - totalInvertido;
  const pnlCerrado = cerradas.reduce((a, c) => a + calcPnL(c.precioCompra, c.precioVenta!, c.cantidad), 0);

  const ls = { display: 'block' as const, marginBottom: '5px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const };
  const editInput = (val: string, onChange: (v: string) => void, w = '80px') => (
    <input type="number" step="0.0001" value={val} onChange={e => onChange(e.target.value)}
      style={{ width: w, background: 'var(--surface2)', border: '1px solid var(--violet)', borderRadius: '6px', padding: '3px 6px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: '12px', textAlign: 'right' }} />
  );
  const iconBtn = (onClick: () => void, icon: React.ReactNode, hoverColor: string) => (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
      onMouseOver={e => (e.currentTarget.style.color = hoverColor)} onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}>{icon}</button>
  );

  const tipoOpts = monedaActiva === 'ARS'
    ? [{ value: 'lecap', label: 'LECAP' }, { value: 'bono', label: 'Bono' }, { value: 'accion_ar', label: 'Acción AR' }, { value: 'on', label: 'ON' }, { value: 'cedear', label: 'CEDEAR' }, { value: 'otro', label: 'Otro' }]
    : [{ value: 'cedear', label: 'CEDEAR' }, { value: 'bono', label: 'Bono' }, { value: 'on', label: 'ON' }, { value: 'accion_ar', label: 'Acción AR' }, { value: 'otro', label: 'Otro' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
          Nuevo Activo <span style={{ color: monedaActiva === 'ARS' ? 'var(--amber)' : 'var(--green)', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>· {monedaActiva}</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '14px' }}>
          {monedaActiva === 'ARS' ? 'Activo en pesos: LECAP, bono ARS, etc.' : 'Activo en USD: CEDEAR segmento D, bono USD, etc.'}
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div><label style={ls}>Tipo</label>
              <select className="input-field" value={form.tipo} onChange={e => set('tipo', e.target.value)} style={{ cursor: 'pointer' }}>
                {tipoOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div><label style={ls}>Ticker</label><input className="input-field" type="text" placeholder={monedaActiva === 'ARS' ? 'S31O5...' : 'NVDAD...'} value={form.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>Cantidad</label><input className="input-field" type="number" step="0.01" placeholder="100" value={form.cantidad} onChange={e => set('cantidad', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>P. compra</label><input className="input-field" type="number" step="0.0001" placeholder="18.50" value={form.precioCompra} onChange={e => set('precioCompra', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
            <div><label style={ls}>P. actual</label><input className="input-field" type="number" step="0.0001" placeholder="19.20" value={form.precioActual} onChange={e => set('precioActual', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} /></div>
          </div>
          {form.precioCompra && form.precioActual && form.cantidad && (
            <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div><span style={{ fontSize: '11px', color: 'var(--muted)' }}>P&L: </span><span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, fontSize: '12px', color: calcPnL(Number(form.precioCompra), Number(form.precioActual), Number(form.cantidad)) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtM(calcPnL(Number(form.precioCompra), Number(form.precioActual), Number(form.cantidad)), monedaActiva)}</span></div>
              <div><span style={{ fontSize: '11px', color: 'var(--muted)' }}>P&L %: </span><span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, fontSize: '12px', color: Number(form.precioActual) >= Number(form.precioCompra) ? 'var(--green)' : 'var(--red)' }}>{fmtPct(calcPnLPct(Number(form.precioCompra), Number(form.precioActual)))}</span></div>
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: '14px' }}>{saving ? 'Guardando...' : '+ Agregar / Sumar a posición'}</button>
        </form>
      </div>

      {activos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
          {[
            { label: 'INVERTIDO', value: fmtM(totalInvertido, monedaActiva), color: 'var(--text)' },
            { label: 'VALOR ACTUAL', value: fmtM(totalActual, monedaActiva), color: 'var(--amber)' },
            { label: 'P&L NO REALIZ.', value: fmtM(pnlAbierto, monedaActiva), color: pnlAbierto >= 0 ? 'var(--green)' : 'var(--red)' },
            { label: 'P&L REALIZ.', value: fmtM(pnlCerrado, monedaActiva), color: pnlCerrado >= 0 ? 'var(--green)' : 'var(--red)' },
          ].map(card => (
            <div key={card.label} className="card">
              <div className="label-xs" style={{ marginBottom: '6px' }}>{card.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', fontWeight: 600, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {abiertas.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div className="label-xs">Posiciones abiertas</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px', fontFamily: 'DM Mono, monospace' }}>Precios se actualizan al cargar</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {refreshMsg && <span style={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', color: refreshMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{refreshMsg}</span>}
              <button onClick={handleRefresh} disabled={refreshing}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '5px 12px', cursor: refreshing ? 'not-allowed' : 'pointer', color: 'var(--text2)', fontSize: '12px', fontFamily: 'Syne, sans-serif', fontWeight: 600, opacity: refreshing ? 0.6 : 1 }}
                onMouseOver={e => { if (!refreshing) e.currentTarget.style.borderColor = 'var(--violet)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                <RefreshCw size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                {refreshing ? '...' : 'Actualizar'}
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  {['Ticker','Tipo','Cant.',`P. prom.`,`P. actual`,'Invertido','Valor actual','P&L','P&L %',''].map((h, i) => (
                    <th key={i} style={{ padding: '9px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: '10px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--muted2)', textTransform: 'uppercase', whiteSpace: 'nowrap', display: (isMobile && ['Cant.','Invertido','Valor actual'].includes(h)) ? 'none' : undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {abiertas.map(a => {
                  const pnl = calcPnL(a.precioCompra, a.precioActual, a.cantidad);
                  const pnlPct = calcPnLPct(a.precioCompra, a.precioActual);
                  const isEditing = editing === a.id; const isSelling = selling === a.id;
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                      onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '10px 10px' }}><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--violet-light)', fontSize: '13px' }}>{a.ticker}</span></td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}><span style={{ fontSize: '9px', background: 'rgba(124,58,237,0.15)', color: 'var(--violet-light)', borderRadius: '4px', padding: '1px 5px' }}>{TIPO_ACTIVO_OPTS.find(o => o.value === a.tipo)?.label || a.tipo}</span></td>
                      {!isMobile && <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtNum(a.cantidad, 2)}</td>}
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtM(a.precioCompra, monedaActiva, 4)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                        {isEditing ? editInput(editPrecio, setEditPrecio) : <span style={{ color: 'var(--text)' }}>{fmtM(a.precioActual, monedaActiva, 4)}</span>}
                      </td>
                      {!isMobile && <>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtM(a.precioCompra * a.cantidad, monedaActiva)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--amber)' }}>{fmtM(a.precioActual * a.cantidad, monedaActiva)}</td>
                      </>}
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: '12px' }}>{fmtM(pnl, monedaActiva)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: pnlPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{fmtPct(pnlPct)}</td>
                      <td style={{ padding: '10px 10px' }}>
                        {isSelling ? (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                            {editInput(sellData.precio, v => setSellData(p => ({ ...p, precio: v })))}
                            {!isMobile && <input type="date" value={sellData.fecha} onChange={e => setSellData(p => ({ ...p, fecha: e.target.value }))} style={{ background: 'var(--surface2)', border: '1px solid var(--violet)', borderRadius: '6px', padding: '3px 6px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: '11px' }} />}
                            <button onClick={async () => { if (!sellData.precio) return; await onUpdate(a.id, { precioVenta: Number(sellData.precio), fechaVenta: sellData.fecha }); setSelling(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: '2px', display: 'flex', alignItems: 'center' }}><Check size={13} /></button>
                            <button onClick={() => setSelling(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={13} /></button>
                          </div>
                        ) : isEditing ? (
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                            <button onClick={async () => { await onUpdate(a.id, { precioActual: Number(editPrecio) }); setEditing(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: '2px', display: 'flex', alignItems: 'center' }}><Check size={13} /></button>
                            <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={13} /></button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
                            {iconBtn(() => { setEditing(a.id); setEditPrecio(String(a.precioActual)); setSelling(null); }, <Pencil size={13} />, 'var(--violet-light)')}
                            {iconBtn(() => { setSelling(a.id); setSellData({ precio: String(a.precioActual), fecha: new Date().toISOString().split('T')[0] }); setEditing(null); }, <TrendingDown size={13} />, 'var(--amber)')}
                            {confirmDelete === a.id ? (
                              <div style={{ display: 'flex', gap: '3px' }}>
                                <button onClick={async () => { await onDelete(a.id); setConfirmDelete(null); }} style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '4px', padding: '1px 7px', cursor: 'pointer', fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Sí</button>
                                <button onClick={() => setConfirmDelete(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={11} /></button>
                              </div>
                            ) : iconBtn(() => setConfirmDelete(a.id), <Trash2 size={13} />, 'var(--red)')}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cerradas.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}><div className="label-xs">Posiciones cerradas</div></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  {['Ticker','Tipo','P. prom.','P. venta','P&L','P&L %', ...(isMobile ? [] : ['Fecha venta']),''].map((h, i) => (
                    <th key={i} style={{ padding: '9px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: '10px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--muted2)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cerradas.map(a => {
                  const pnl = calcPnL(a.precioCompra, a.precioVenta!, a.cantidad);
                  const pnlPct = calcPnLPct(a.precioCompra, a.precioVenta!);
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)', opacity: 0.75 }}
                      onMouseOver={e => (e.currentTarget.style.opacity = '1')} onMouseOut={e => (e.currentTarget.style.opacity = '0.75')}>
                      <td style={{ padding: '10px 10px' }}><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--muted2)', fontSize: '13px' }}>{a.ticker}</span></td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}><span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.06)', color: 'var(--muted2)', borderRadius: '4px', padding: '1px 5px' }}>{TIPO_ACTIVO_OPTS.find(o => o.value === a.tipo)?.label || a.tipo}</span></td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtM(a.precioCompra, monedaActiva, 4)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text)' }}>{fmtM(a.precioVenta!, monedaActiva, 4)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{fmtM(pnl, monedaActiva)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: pnlPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{fmtPct(pnlPct)}</td>
                      {!isMobile && <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--muted2)', fontSize: '11px' }}>{a.fechaVenta || '—'}</td>}
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>{iconBtn(() => onDelete(a.id), <Trash2 size={13} />, 'var(--red)')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activos.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>📊</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--text)', marginBottom: '8px' }}>Sin activos en {monedaActiva}</div>
          <div style={{ fontSize: '13px', color: 'var(--muted2)' }}>{monedaActiva === 'ARS' ? 'Agregá LECAPs, bonos ARS, etc.' : 'Agregá CEDEARs, bonos USD, etc.'}</div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Tab: Resumen ─────────────────────────────────────────────────────────────

function ResumenTab({ cauciones, periodos, activos, monedaActiva }: {
  cauciones: Caucion[]; periodos: Record<string, CaucionPeriodo[]>; activos: Activo[]; monedaActiva: Moneda;
}) {
  const isMobile = useIsMobile();
  const abiertas = activos.filter(a => !a.precioVenta);
  const cerradas = activos.filter(a => a.precioVenta !== undefined);
  const totalInvertido = abiertas.reduce((a, c) => a + c.precioCompra * c.cantidad, 0);
  const totalActual = abiertas.reduce((a, c) => a + c.precioActual * c.cantidad, 0);
  const pnlNoRealizado = totalActual - totalInvertido;
  const pnlRealizado = cerradas.reduce((a, c) => a + calcPnL(c.precioCompra, c.precioVenta!, c.cantidad), 0);
  const pnlTotal = pnlNoRealizado + pnlRealizado;
  const totalCostoCauciones = cauciones.reduce((total, c) => {
    const historico = (periodos[c.id] ?? []).reduce((a, p) => a + p.intereses, 0);
    return total + historico + calcInteresPeriodo(c.monto, c.tna, c.plazo);
  }, 0);
  const rendimientoNeto = pnlTotal - totalCostoCauciones;
  const rendimientoNetoPct = totalInvertido > 0 ? (rendimientoNeto / totalInvertido) * 100 : 0;

  const pnlPorActivo = abiertas.map(a => ({ name: a.ticker, valor: parseFloat(calcPnL(a.precioCompra, a.precioActual, a.cantidad).toFixed(2)) })).sort((a, b) => b.valor - a.valor);
  const estrategiaData = [
    { name: 'P&L activos', valor: parseFloat(pnlTotal.toFixed(2)), color: pnlTotal >= 0 ? '#10b981' : '#ef4444' },
    { name: 'Costo cauciones', valor: parseFloat((-totalCostoCauciones).toFixed(2)), color: '#ef4444' },
    { name: 'Rend. neto', valor: parseFloat(rendimientoNeto.toFixed(2)), color: rendimientoNeto >= 0 ? '#10b981' : '#ef4444' },
  ];

  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' };
  const axisProps = { tick: { fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }, axisLine: false as const, tickLine: false as const };
  const chartH = isMobile ? 180 : 220;

  if (cauciones.length === 0 && activos.length === 0) return (
    <div className="card" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 800, color: 'var(--border)', marginBottom: '16px' }}>SIN DATOS · {monedaActiva}</div>
      <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Cargá cauciones y activos en {monedaActiva} arriba.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
        {[
          { label: 'P&L NO REALIZ.', value: fmtM(pnlNoRealizado, monedaActiva), sub: `${abiertas.length} posición${abiertas.length !== 1 ? 'es' : ''} abierta${abiertas.length !== 1 ? 's' : ''}`, color: pnlNoRealizado >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'P&L REALIZ.', value: fmtM(pnlRealizado, monedaActiva), sub: `${cerradas.length} posición${cerradas.length !== 1 ? 'es' : ''} cerrada${cerradas.length !== 1 ? 's' : ''}`, color: pnlRealizado >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'P&L TOTAL', value: fmtM(pnlTotal, monedaActiva), sub: totalInvertido > 0 ? fmtPct((pnlTotal / totalInvertido) * 100) : '—', color: pnlTotal >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'COSTO CAUCIONES', value: fmtM(totalCostoCauciones, monedaActiva), sub: `${cauciones.length} caución${cauciones.length !== 1 ? 'es' : ''}`, color: 'var(--red)' },
          { label: 'REND. NETO', value: fmtM(rendimientoNeto, monedaActiva), sub: fmtPct(rendimientoNetoPct), color: rendimientoNeto >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(card => (
          <div key={card.label} className="card">
            <div className="label-xs" style={{ marginBottom: '6px' }}>{card.label}</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', fontWeight: 600, color: card.color, marginBottom: '3px' }}>{card.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {abiertas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
          <div className="card">
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>P&L por activo ({monedaActiva})</div>
            <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '14px' }}>Ganancia o pérdida de cada posición abierta.</div>
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={pnlPorActivo} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtM(v, monedaActiva), 'P&L']} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                  {pnlPorActivo.map((e, i) => <Cell key={i} fill={e.valor >= 0 ? '#10b981' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Resultado total ({monedaActiva})</div>
            <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '14px' }}>P&L activos vs costo cauciones. La última barra es lo que ganás.</div>
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={estrategiaData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtM(v, monedaActiva), monedaActiva]} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                  {estrategiaData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type Tab = 'resumen' | 'cauciones' | 'activos';

export default function CaucionesPage() {
  const isMobile = useIsMobile();
  const [userId, setUserId] = useState<string | null>(null);
  const [cauciones, setCauciones] = useState<Caucion[]>([]);
  const [periodos, setPeriodos] = useState<Record<string, CaucionPeriodo[]>>({});
  const [activos, setActivos] = useState<Activo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('resumen');
  const [monedaActiva, setMonedaActiva] = useState<Moneda>('USD');

  useEffect(() => { supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id); }); }, []);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoading(true);
      const [caucRes, perRes, actRes] = await Promise.all([
        supabase.from('cauciones').select('*').eq('user_id', userId).order('created_at'),
        supabase.from('caucion_periodos').select('*').eq('user_id', userId).order('created_at'),
        supabase.from('cedears_arb').select('*').eq('user_id', userId).order('created_at'),
      ]);
      if (caucRes.data) setCauciones(caucRes.data.map(rowToCaucion));
      if (perRes.data) {
        const grouped: Record<string, CaucionPeriodo[]> = {};
        perRes.data.forEach(r => { const p = rowToPeriodo(r); if (!grouped[p.caucionId]) grouped[p.caucionId] = []; grouped[p.caucionId].push(p); });
        setPeriodos(grouped);
      }
      if (actRes.data) setActivos(actRes.data.map(rowToActivo));
      setLoading(false);
    };
    load();
  }, [userId]);

  const caucionesFiltradas = cauciones.filter(c => c.moneda === monedaActiva);
  const activosFiltrados = activos.filter(a => a.moneda === monedaActiva);

  const addCaucion = useCallback(async (data: Omit<Caucion, 'id' | 'renovaciones'>) => {
    if (!userId) return;
    const id = genId();
    const { data: row } = await supabase.from('cauciones').insert({ id, user_id: userId, descripcion: data.descripcion, monto: data.monto, tna: data.tna, plazo: data.plazo, fecha_inicio: data.fechaInicio, renovaciones: 0, moneda: data.moneda }).select().single();
    if (row) setCauciones(p => [...p, rowToCaucion(row)]);
  }, [userId]);

  const renovarCaucion = useCallback(async (id: string, params: { monto: number; tna: number; plazo: number; fechaInicio: string }) => {
    if (!userId) return;
    const caucion = cauciones.find(c => c.id === id); if (!caucion) return;
    const periodoId = genId(); const intereses = calcInteresPeriodo(caucion.monto, caucion.tna, caucion.plazo);
    await supabase.from('caucion_periodos').insert({ id: periodoId, caucion_id: id, user_id: userId, monto: caucion.monto, tna: caucion.tna, plazo: caucion.plazo, fecha_inicio: caucion.fechaInicio, intereses });
    const { data: row } = await supabase.from('cauciones').update({ monto: params.monto, tna: params.tna, plazo: params.plazo, fecha_inicio: params.fechaInicio, renovaciones: caucion.renovaciones + 1 }).eq('id', id).select().single();
    if (row) { setCauciones(p => p.map(c => c.id === id ? rowToCaucion(row) : c)); setPeriodos(p => ({ ...p, [id]: [...(p[id] ?? []), { id: periodoId, caucionId: id, monto: caucion.monto, tna: caucion.tna, plazo: caucion.plazo, fechaInicio: caucion.fechaInicio, intereses }] })); }
  }, [userId, cauciones]);

  const deleteCaucion = useCallback(async (id: string) => {
    if (!userId) return;
    await supabase.from('caucion_periodos').delete().eq('caucion_id', id);
    await supabase.from('cauciones').delete().eq('id', id).eq('user_id', userId);
    setCauciones(p => p.filter(c => c.id !== id));
    setPeriodos(p => { const next = { ...p }; delete next[id]; return next; });
  }, [userId]);

  const addActivo = useCallback(async (data: Omit<Activo, 'id'>) => {
    if (!userId) return;
    const existing = activos.find(a => a.ticker === data.ticker && a.moneda === data.moneda && !a.precioVenta);
    if (existing) {
      const totalCantidad = existing.cantidad + data.cantidad;
      const precioPromedio = (existing.cantidad * existing.precioCompra + data.cantidad * data.precioCompra) / totalCantidad;
      await supabase.from('cedears_arb').update({ cantidad: totalCantidad, precio_compra: precioPromedio, precio_actual: data.precioActual }).eq('id', existing.id).eq('user_id', userId);
      setActivos(p => p.map(a => a.id === existing.id ? { ...a, cantidad: totalCantidad, precioCompra: precioPromedio, precioActual: data.precioActual } : a));
    } else {
      const id = genId();
      const { data: row } = await supabase.from('cedears_arb').insert({ id, user_id: userId, ticker: data.ticker, tipo: data.tipo, cantidad: data.cantidad, precio_compra: data.precioCompra, precio_actual: data.precioActual, moneda: data.moneda }).select().single();
      if (row) setActivos(p => [...p, rowToActivo(row)]);
    }
  }, [userId, activos]);

  const updateActivo = useCallback(async (id: string, data: Partial<Omit<Activo, 'id'>>) => {
    if (!userId) return;
    const updates: Record<string, unknown> = {};
    if (data.precioActual !== undefined) updates.precio_actual = data.precioActual;
    if (data.precioVenta !== undefined) updates.precio_venta = data.precioVenta;
    if (data.fechaVenta !== undefined) updates.fecha_venta = data.fechaVenta;
    if (data.cantidad !== undefined) updates.cantidad = data.cantidad;
    await supabase.from('cedears_arb').update(updates).eq('id', id).eq('user_id', userId);
    setActivos(p => p.map(a => a.id === id ? { ...a, ...data } : a));
  }, [userId]);

  const deleteActivo = useCallback(async (id: string) => {
    if (!userId) return;
    await supabase.from('cedears_arb').delete().eq('id', id).eq('user_id', userId);
    setActivos(p => p.filter(a => a.id !== id));
  }, [userId]);

  if (loading) return (
    <div style={{ maxWidth: '1100px', marginTop: '60px', textAlign: 'center' }}>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando cauciones...</div>
    </div>
  );

  const statsUSD = { caucs: cauciones.filter(c => c.moneda === 'USD').length, acts: activos.filter(a => a.moneda === 'USD').length };
  const statsARS = { caucs: cauciones.filter(c => c.moneda === 'ARS').length, acts: activos.filter(a => a.moneda === 'ARS').length };

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: isMobile ? '20px' : '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Cauciones</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Estrategia por moneda · capital y rendimiento.</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['USD', 'ARS'] as Moneda[]).map(m => {
            const stats = m === 'USD' ? statsUSD : statsARS;
            const active = monedaActiva === m;
            return (
              <button key={m} onClick={() => setMonedaActiva(m)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isMobile ? '8px 16px' : '10px 20px', borderRadius: '10px', border: `2px solid ${active ? (m === 'USD' ? '#10b981' : 'var(--amber)') : 'var(--border)'}`, background: active ? (m === 'USD' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)') : 'var(--surface2)', cursor: 'pointer', transition: 'all 0.15s' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 800, fontSize: '15px', color: active ? (m === 'USD' ? '#10b981' : 'var(--amber)') : 'var(--muted2)' }}>{m}</span>
                <span style={{ fontSize: '9px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginTop: '2px' }}>{stats.caucs}c · {stats.acts}a</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px', width: 'fit-content' }}>
        {[{ key: 'resumen' as Tab, label: 'Resumen', icon: '📊' }, { key: 'cauciones' as Tab, label: 'Cauciones', icon: '📋' }, { key: 'activos' as Tab, label: 'Activos', icon: '💼' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: tab === t.key ? 'var(--violet)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted2)', border: 'none', borderRadius: '8px', padding: isMobile ? '7px 12px' : '8px 16px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: isMobile ? '12px' : '13px', transition: 'all 0.15s' }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab cauciones={caucionesFiltradas} periodos={periodos} activos={activosFiltrados} monedaActiva={monedaActiva} />}
      {tab === 'cauciones' && <CaucionesTab cauciones={caucionesFiltradas} periodos={periodos} monedaActiva={monedaActiva} onAdd={addCaucion} onRenovar={renovarCaucion} onDelete={deleteCaucion} />}
      {tab === 'activos' && <ActivosTab activos={activosFiltrados} monedaActiva={monedaActiva} onAdd={addActivo} onUpdate={updateActivo} onDelete={deleteActivo} />}
    </div>
  );
}

'use client';
import { useState, useEffect, useCallback } from 'react';
import { Trash2, RefreshCw, Check, X, ChevronRight, ChevronDown, Clock, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Caucion {
  id: string; descripcion: string; monto: number; tna: number;
  plazo: number; fechaInicio: string; renovaciones: number;
}
interface CaucionPeriodo {
  id: string; caucionId: string; monto: number; tna: number;
  plazo: number; fechaInicio: string; intereses: number;
}

// ─── Calculations ─────────────────────────────────────────────────────────────

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
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.ceil((venc.getTime() - hoy.getTime()) / 86400000);
}

function calcInteresPeriodo(monto: number, tna: number, plazo: number): number {
  return monto * (tna / 100) * (plazo / 365);
}

function calcTEA(tna: number, plazo: number): number {
  return (Math.pow(1 + (tna / 100) * (plazo / 365), 365 / plazo) - 1) * 100;
}

const fmtUSD = (n: number, dec = 2): string =>
  '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

const fmtPct = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

// ─── Supabase helpers ─────────────────────────────────────────────────────────

const genId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2);

function rowToCaucion(r: any): Caucion {
  return { id: r.id, descripcion: r.descripcion || '', monto: r.monto, tna: r.tna, plazo: r.plazo, fechaInicio: r.fecha_inicio, renovaciones: r.renovaciones ?? 0 };
}
function rowToPeriodo(r: any): CaucionPeriodo {
  return { id: r.id, caucionId: r.caucion_id, monto: r.monto, tna: r.tna, plazo: r.plazo, fechaInicio: r.fecha_inicio, intereses: r.intereses };
}

// ─── Tab: Cauciones ───────────────────────────────────────────────────────────

interface CaucionesTabProps {
  cauciones: Caucion[]; periodos: Record<string, CaucionPeriodo[]>;
  onAdd: (data: Omit<Caucion, 'id' | 'renovaciones'>) => Promise<void>;
  onRenovar: (id: string, params: { monto: number; tna: number; plazo: number; fechaInicio: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function CaucionesTab({ cauciones, periodos, onAdd, onRenovar, onDelete }: CaucionesTabProps) {
  const EMPTY = { descripcion: '', monto: '', tna: '', plazo: '', fechaInicio: new Date().toISOString().split('T')[0] };
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [renovando, setRenovando] = useState<string | null>(null);
  const [renovForm, setRenovForm] = useState({ monto: '', tna: '', plazo: '', fechaInicio: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.monto || !form.tna || !form.plazo) return;
    setSaving(true);
    await onAdd({ descripcion: form.descripcion, monto: Number(form.monto), tna: Number(form.tna), plazo: Number(form.plazo), fechaInicio: form.fechaInicio });
    setForm(EMPTY);
    setSaving(false);
  };

  const startRenovar = (c: Caucion) => {
    setRenovando(c.id);
    setRenovForm({ monto: String(c.monto), tna: String(c.tna), plazo: String(c.plazo), fechaInicio: calcVencimientoISO(c.fechaInicio, c.plazo) });
  };

  const confirmRenovar = async (id: string) => {
    if (!renovForm.monto || !renovForm.tna || !renovForm.plazo) return;
    await onRenovar(id, { monto: Number(renovForm.monto), tna: Number(renovForm.tna), plazo: Number(renovForm.plazo), fechaInicio: renovForm.fechaInicio });
    setRenovando(null);
  };

  const toggleExpanded = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalMonto = cauciones.reduce((a, c) => a + c.monto, 0);
  const totalCosto = cauciones.reduce((a, c) => {
    const hist = (periodos[c.id] ?? []).reduce((s, p) => s + p.intereses, 0);
    return a + hist + calcInteresPeriodo(c.monto, c.tna, c.plazo);
  }, 0);

  const ls = { display: 'block' as const, marginBottom: '6px', fontSize: '11px', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const };

  const inlineInput = (val: string, onChange: (v: string) => void, placeholder: string, w = '80px', type = 'number') => (
    <input type={type} value={val} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: w, background: 'var(--surface2)', border: '1px solid var(--violet)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: '12px', textAlign: type === 'number' ? 'right' : 'left' as any }} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Formulario nueva caución */}
      <div className="card">
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>Nueva Caución Tomadora</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={ls}>Descripción</label>
              <input className="input-field" type="text" placeholder="Ej: Caución BYMA 14/5" value={form.descripcion} onChange={e => set('descripcion', e.target.value)} />
            </div>
            <div>
              <label style={ls}>Monto (USD)</label>
              <input className="input-field" type="number" step="0.01" placeholder="10000" value={form.monto} onChange={e => set('monto', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} />
            </div>
            <div>
              <label style={ls}>TNA (%)</label>
              <input className="input-field" type="number" step="0.01" placeholder="8.5" value={form.tna} onChange={e => set('tna', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} />
            </div>
            <div>
              <label style={ls}>Plazo (días)</label>
              <input className="input-field" type="number" placeholder="7" value={form.plazo} onChange={e => set('plazo', e.target.value)} required style={{ fontFamily: 'DM Mono, monospace' }} />
            </div>
            <div>
              <label style={ls}>Fecha inicio</label>
              <input className="input-field" type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} />
            </div>
          </div>
          {/* Preview */}
          {form.monto && form.tna && form.plazo && (
            <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Interés estimado: </span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--red)' }}>{fmtUSD(calcInteresPeriodo(Number(form.monto), Number(form.tna), Number(form.plazo)))}</span>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>TEA: </span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--violet-light)' }}>{calcTEA(Number(form.tna), Number(form.plazo)).toFixed(2)}%</span>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Vencimiento: </span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--text2)' }}>{calcVencimiento(form.fechaInicio, Number(form.plazo))}</span>
              </div>
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: '14px' }}>
            {saving ? 'Guardando...' : '+ Agregar Caución'}
          </button>
        </form>
      </div>

      {/* Cards resumen */}
      {cauciones.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { label: 'TOTAL TOMADO', value: fmtUSD(totalMonto), color: 'var(--amber)' },
            { label: 'COSTO ACUMULADO', value: fmtUSD(totalCosto), color: 'var(--red)' },
            { label: 'POSICIONES', value: `${cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) >= 0).length} vigentes / ${cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) < 0).length} vencidas`, color: 'var(--text)' },
          ].map(card => (
            <div key={card.label} className="card">
              <div className="label-xs" style={{ marginBottom: '8px' }}>{card.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', fontWeight: 600, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      {cauciones.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <th style={{ width: '32px', padding: '10px 8px' }}></th>
                  {['Descripción','Monto USD','TNA','Plazo','Vencimiento','Días rest.','Renovac.','Int. período','Int. total','Estado',''].map((h, i) => (
                    <th key={h + i} style={{ padding: '10px 14px', textAlign: h === 'Descripción' ? 'left' : 'right', fontSize: '11px', fontWeight: 700, fontFamily: 'Syne, sans-serif', letterSpacing: '0.06em', color: 'var(--muted2)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
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
                  const costoHistorico = historial.reduce((a, p) => a + p.intereses, 0);
                  const costoActual = calcInteresPeriodo(c.monto, c.tna, c.plazo);
                  const costoTotal = costoHistorico + costoActual;

                  return (
                    <>
                      <tr key={c.id} style={{ borderBottom: (isRenovando || isExpanded) ? 'none' : '1px solid var(--border)' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          {historial.length > 0 && (
                            <button onClick={() => toggleExpanded(c.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', padding: '2px', display: 'flex', alignItems: 'center' }}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text)' }}>{c.descripcion || '—'}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--amber)', fontWeight: 500 }}>{fmtUSD(c.monto)}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--violet-light)' }}>{c.tna.toFixed(2)}%</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{c.plazo}d</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{calcVencimiento(c.fechaInicio, c.plazo)}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: diasColor, fontWeight: 600 }}>{dias}d</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{c.renovaciones === 0 ? '—' : `${c.renovaciones}x`}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--red)' }}>{fmtUSD(costoActual)}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>{fmtUSD(costoTotal)}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'Syne, sans-serif', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: '20px', background: vigente ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', color: vigente ? 'var(--green)' : 'var(--muted)', border: `1px solid ${vigente ? 'rgba(16,185,129,0.2)' : 'var(--border)'}` }}>
                            {vigente ? 'VIGENTE' : 'VENCIDA'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button onClick={() => startRenovar(c)} title="Renovar"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isRenovando ? 'var(--violet-light)' : 'var(--muted)', padding: '3px', display: 'flex', alignItems: 'center' }}
                              onMouseOver={e => (e.currentTarget.style.color = 'var(--violet-light)')}
                              onMouseOut={e => (e.currentTarget.style.color = isRenovando ? 'var(--violet-light)' : 'var(--muted)')}>
                              <RefreshCw size={14} />
                            </button>
                            {confirmDelete === c.id ? (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={async () => { await onDelete(c.id); setConfirmDelete(null); }} style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Sí</button>
                                <button onClick={() => setConfirmDelete(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={12} /></button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDelete(c.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px', display: 'flex', alignItems: 'center' }}
                                onMouseOver={e => (e.currentTarget.style.color = 'var(--red)')}
                                onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Historial expandible */}
                      {isExpanded && historial.length > 0 && (
                        <tr key={`hist-${c.id}`} style={{ borderBottom: isRenovando ? 'none' : '1px solid var(--border)' }}>
                          <td colSpan={13} style={{ padding: '0 0 0 40px', background: 'rgba(0,0,0,0.15)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                  {['Período','Monto','TNA','Plazo','Fecha inicio','Intereses'].map(h => (
                                    <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Período' ? 'left' : 'right', fontSize: '10px', fontWeight: 700, fontFamily: 'Syne, sans-serif', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {historial.map((p, idx) => (
                                  <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                    <td style={{ padding: '8px 14px', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px' }}>Período {idx + 1}</td>
                                    <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{fmtUSD(p.monto)}</td>
                                    <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{p.tna.toFixed(2)}%</td>
                                    <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{p.plazo}d</td>
                                    <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--muted2)' }}>{p.fechaInicio}</td>
                                    <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--red)' }}>{fmtUSD(p.intereses)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}

                      {/* Formulario renovación inline */}
                      {isRenovando && (
                        <tr key={`renov-${c.id}`} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(124,58,237,0.04)' }}>
                          <td colSpan={13} style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--violet-light)', textTransform: 'uppercase' }}>Renovar</span>
                              {[
                                { label: 'Monto', field: 'monto' as const, placeholder: '10000', w: '90px' },
                                { label: 'TNA %', field: 'tna' as const, placeholder: '8.5', w: '70px' },
                                { label: 'Plazo d', field: 'plazo' as const, placeholder: '7', w: '60px' },
                              ].map(({ label, field, placeholder, w }) => (
                                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '11px', color: 'var(--muted2)' }}>{label}</span>
                                  {inlineInput(renovForm[field], v => setRenovForm(p => ({ ...p, [field]: v })), placeholder, w)}
                                </div>
                              ))}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--muted2)' }}>Fecha</span>
                                {inlineInput(renovForm.fechaInicio, v => setRenovForm(p => ({ ...p, fechaInicio: v })), '', '130px', 'date')}
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => confirmRenovar(c.id)}
                                  style={{ background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Check size={12} /> Confirmar
                                </button>
                                <button onClick={() => setRenovando(null)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center' }}>
                                  <X size={14} />
                                </button>
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
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>📋</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--text)', marginBottom: '8px' }}>Sin cauciones registradas</div>
          <div style={{ fontSize: '13px', color: 'var(--muted2)' }}>Agregá una caución tomadora arriba para empezar a trackear.</div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Resumen ─────────────────────────────────────────────────────────────

function ResumenTab({ cauciones, periodos }: { cauciones: Caucion[]; periodos: Record<string, CaucionPeriodo[]> }) {
  const vigentes = cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) >= 0);
  const vencidas = cauciones.filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) < 0);

  const totalMonto = vigentes.reduce((a, c) => a + c.monto, 0);
  const tnaProm = vigentes.length > 0
    ? vigentes.reduce((a, c) => a + c.tna * c.monto, 0) / vigentes.reduce((a, c) => a + c.monto, 0)
    : 0;

  const costoVigentes = vigentes.reduce((a, c) => a + calcInteresPeriodo(c.monto, c.tna, c.plazo), 0);
  const costoHistorico = cauciones.reduce((a, c) => (periodos[c.id] ?? []).reduce((s, p) => s + p.intereses, a), 0);
  const costoTotal = cauciones.reduce((a, c) => {
    const hist = (periodos[c.id] ?? []).reduce((s, p) => s + p.intereses, 0);
    return a + hist + calcInteresPeriodo(c.monto, c.tna, c.plazo);
  }, 0);

  // Chart data: costo estimado por caución vigente
  const chartData = vigentes.map(c => ({
    name: c.descripcion || c.id.slice(-4),
    costo: parseFloat(calcInteresPeriodo(c.monto, c.tna, c.plazo).toFixed(2)),
    tna: c.tna,
    monto: c.monto,
  }));

  // Próximas renovaciones
  const proximas = [...cauciones]
    .filter(c => calcDiasRestantes(c.fechaInicio, c.plazo) >= 0)
    .sort((a, b) => calcDiasRestantes(a.fechaInicio, a.plazo) - calcDiasRestantes(b.fechaInicio, b.plazo))
    .slice(0, 5);

  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' };

  if (cauciones.length === 0) return (
    <div className="card" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800, color: 'var(--border)', marginBottom: '16px', letterSpacing: '0.1em' }}>CAUCIONES</div>
      <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Cargá cauciones en la pestaña anterior para ver el resumen.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
        {[
          { label: 'CAPITAL TOMADO', value: fmtUSD(totalMonto), sub: `${vigentes.length} posición${vigentes.length !== 1 ? 'es' : ''} vigente${vigentes.length !== 1 ? 's' : ''}`, color: 'var(--amber)' },
          { label: 'TNA PROMEDIO', value: tnaProm.toFixed(2) + '%', sub: 'Ponderada por monto', color: 'var(--violet-light)' },
          { label: 'COSTO PERÍODO ACT.', value: fmtUSD(costoVigentes), sub: 'Intereses en curso', color: 'var(--red)' },
          { label: 'COSTO HISTÓRICO', value: fmtUSD(costoHistorico), sub: 'Períodos anteriores', color: 'var(--red)' },
          { label: 'COSTO TOTAL ACUM.', value: fmtUSD(costoTotal), sub: `${vencidas.length} vencida${vencidas.length !== 1 ? 's' : ''}`, color: 'var(--red)' },
        ].map(card => (
          <div key={card.label} className="card">
            <div className="label-xs" style={{ marginBottom: '8px' }}>{card.label}</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', fontWeight: 600, color: card.color, marginBottom: '4px' }}>{card.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Chart: costo por caución */}
        {chartData.length > 0 && (
          <div className="card">
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Costo estimado por caución (USD)</div>
            <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '16px' }}>Interés del período actual de cada posición vigente</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--muted2)', fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted2)', fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Costo']} />
                <Bar dataKey="costo" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill="#ef4444" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Próximas renovaciones */}
        {proximas.length > 0 && (
          <div className="card">
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Próximas renovaciones</div>
            <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '16px' }}>Cauciones vigentes ordenadas por vencimiento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {proximas.map(c => {
                const dias = calcDiasRestantes(c.fechaInicio, c.plazo);
                const diasColor = dias < 2 ? 'var(--red)' : dias < 4 ? 'var(--amber)' : 'var(--green)';
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--surface2)', borderRadius: '8px', border: `1px solid ${dias < 2 ? 'rgba(244,63,94,0.2)' : 'var(--border)'}` }}>
                    {dias < 2 ? <AlertTriangle size={14} color="var(--red)" /> : <Clock size={14} color="var(--muted)" />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion || `Caución ${c.id.slice(-4)}`}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{fmtUSD(c.monto)} · {c.tna.toFixed(2)}% TNA</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: '14px', color: diasColor }}>{dias}d</div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{calcVencimiento(c.fechaInicio, c.plazo)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* TNA por caución */}
      {chartData.length > 0 && (
        <div className="card">
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>TNA por caución (%)</div>
          <div style={{ fontSize: '11px', color: 'var(--muted2)', marginBottom: '16px' }}>Comparativa de tasas entre posiciones vigentes</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--muted2)', fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--muted2)', fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}%`, 'TNA']} />
              <Bar dataKey="tna" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill="#7c3aed" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type Tab = 'cauciones' | 'resumen';

export default function CaucionesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cauciones, setCauciones] = useState<Caucion[]>([]);
  const [periodos, setPeriodos] = useState<Record<string, CaucionPeriodo[]>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('cauciones');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoading(true);
      const [caucRes, perRes] = await Promise.all([
        supabase.from('cauciones').select('*').eq('user_id', userId).order('created_at'),
        supabase.from('caucion_periodos').select('*').eq('user_id', userId).order('created_at'),
      ]);
      if (caucRes.data) setCauciones(caucRes.data.map(rowToCaucion));
      if (perRes.data) {
        const grouped: Record<string, CaucionPeriodo[]> = {};
        perRes.data.forEach(r => {
          const p = rowToPeriodo(r);
          if (!grouped[p.caucionId]) grouped[p.caucionId] = [];
          grouped[p.caucionId].push(p);
        });
        setPeriodos(grouped);
      }
      setLoading(false);
    };
    load();
  }, [userId]);

  const addCaucion = useCallback(async (data: Omit<Caucion, 'id' | 'renovaciones'>) => {
    if (!userId) return;
    const id = genId();
    const { data: row } = await supabase.from('cauciones').insert({
      id, user_id: userId, descripcion: data.descripcion,
      monto: data.monto, tna: data.tna, plazo: data.plazo,
      fecha_inicio: data.fechaInicio, renovaciones: 0,
    }).select().single();
    if (row) setCauciones(p => [...p, rowToCaucion(row)]);
  }, [userId]);

  const renovarCaucion = useCallback(async (id: string, params: { monto: number; tna: number; plazo: number; fechaInicio: string }) => {
    if (!userId) return;
    const caucion = cauciones.find(c => c.id === id);
    if (!caucion) return;
    const periodoId = genId();
    const intereses = calcInteresPeriodo(caucion.monto, caucion.tna, caucion.plazo);
    await supabase.from('caucion_periodos').insert({
      id: periodoId, caucion_id: id, user_id: userId,
      monto: caucion.monto, tna: caucion.tna, plazo: caucion.plazo,
      fecha_inicio: caucion.fechaInicio, intereses,
    });
    const { data: row } = await supabase.from('cauciones').update({
      monto: params.monto, tna: params.tna, plazo: params.plazo,
      fecha_inicio: params.fechaInicio, renovaciones: caucion.renovaciones + 1,
    }).eq('id', id).select().single();
    if (row) {
      setCauciones(p => p.map(c => c.id === id ? rowToCaucion(row) : c));
      setPeriodos(p => ({ ...p, [id]: [...(p[id] ?? []), { id: periodoId, caucionId: id, monto: caucion.monto, tna: caucion.tna, plazo: caucion.plazo, fechaInicio: caucion.fechaInicio, intereses }] }));
    }
  }, [userId, cauciones]);

  const deleteCaucion = useCallback(async (id: string) => {
    if (!userId) return;
    await supabase.from('caucion_periodos').delete().eq('caucion_id', id);
    await supabase.from('cauciones').delete().eq('id', id).eq('user_id', userId);
    setCauciones(p => p.filter(c => c.id !== id));
    setPeriodos(p => { const next = { ...p }; delete next[id]; return next; });
  }, [userId]);

  if (loading) return (
    <div style={{ maxWidth: '1100px', marginTop: '60px', textAlign: 'center' }}>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando cauciones...</div>
    </div>
  );

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Cauciones</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Gestión de cauciones tomadoras y seguimiento de costos.</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px', width: 'fit-content' }}>
        {[{ key: 'cauciones' as Tab, label: 'Cauciones', icon: '📋' }, { key: 'resumen' as Tab, label: 'Resumen', icon: '📊' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tab === t.key ? 'var(--violet)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted2)', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', transition: 'all 0.15s' }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'cauciones' && (
        <CaucionesTab
          cauciones={cauciones}
          periodos={periodos}
          onAdd={addCaucion}
          onRenovar={renovarCaucion}
          onDelete={deleteCaucion}
        />
      )}

      {tab === 'resumen' && (
        <ResumenTab cauciones={cauciones} periodos={periodos} />
      )}
    </div>
  );
}

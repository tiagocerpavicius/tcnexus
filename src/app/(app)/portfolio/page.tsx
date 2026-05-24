'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, X, TrendingUp, TrendingDown } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { supabase } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────
interface Operacion {
  id: string;
  fecha: string;
  ticker: string;
  nombre: string | null;
  tipo: 'compra' | 'venta' | 'aportacion' | 'retiro' | 'dividendo';
  cantidad: number | null;
  precio_unitario: number | null;
  monto_usd: number;
  moneda: 'ARS' | 'USD';
  tipo_activo: string | null;
  broker: string | null;
  notas: string | null;
}

interface PosicionBase {
  ticker: string;
  nombre: string;
  tipo_activo: string;
  broker: string;
  moneda: 'ARS' | 'USD';
  cantidad: number;
  costoTotalUSD: number;
}

interface PosicionCompleta extends PosicionBase {
  costoPromedioUSD: number;
  precioActual: number | null;
  valorActualUSD: number | null;
  pnlUSD: number | null;
  pnlPct: number | null;
  variacionDiaria: number | null;
  loadingPrecio: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtUSD = (n: number | null, dec = 2) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtNum = (n: number | null, dec = 2) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const TIPO_LABELS: Record<string, string> = {
  cedear: 'CEDEAR', accion_ar: 'Acción AR', bono: 'Bono', on: 'ON',
  etf: 'ETF', crypto: 'Crypto', efectivo: 'Efectivo', otro: 'Otro',
};
const TIPO_COLORS_OP: Record<string, string> = {
  compra: 'var(--green)', venta: 'var(--red)', aportacion: '#06b6d4',
  retiro: 'var(--amber)', dividendo: 'var(--violet-light)',
};
const DIST_COLORS = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#a3e635'];

// ── XIRR ─────────────────────────────────────────────────────────────────────
function calcularXIRR(operaciones: Operacion[], valorActualUSD: number): number | null {
  const cf: { fecha: Date; monto: number }[] = [];
  for (const op of operaciones) {
    const fecha = new Date(op.fecha + 'T12:00:00');
    if (op.tipo === 'aportacion') cf.push({ fecha, monto: -op.monto_usd });
    else if (op.tipo === 'retiro')    cf.push({ fecha, monto:  op.monto_usd });
    else if (op.tipo === 'dividendo') cf.push({ fecha, monto:  op.monto_usd });
  }
  if (!cf.length) return null;
  cf.push({ fecha: new Date(), monto: valorActualUSD });
  cf.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  if (!cf.some(f => f.monto < 0) || !cf.some(f => f.monto > 0)) return null;
  const t0 = cf[0].fecha.getTime();
  const flows = cf.map(f => ({ t: (f.fecha.getTime() - t0) / (365.25 * 86400000), v: f.monto }));
  let tir = 0.1;
  for (let i = 0; i < 300; i++) {
    let npv = 0, dnpv = 0;
    for (const { t, v } of flows) {
      const d = Math.pow(1 + tir, t);
      npv += v / d; dnpv -= (t * v) / (d * (1 + tir));
    }
    if (Math.abs(npv) < 0.00001 || Math.abs(dnpv) < 1e-10) break;
    tir -= npv / dnpv;
    if (tir < -0.99) tir = -0.99; if (tir > 50) tir = 50;
  }
  return +(tir * 100).toFixed(2);
}

// ── Position calculation ──────────────────────────────────────────────────────
function calcularPosicionesBase(ops: Operacion[]): Map<string, PosicionBase> {
  const map = new Map<string, PosicionBase>();
  for (const op of ops.filter(o => o.tipo === 'compra' || o.tipo === 'venta')) {
    if (!map.has(op.ticker)) {
      map.set(op.ticker, { ticker: op.ticker, nombre: op.nombre || op.ticker, tipo_activo: op.tipo_activo || 'otro', broker: op.broker || '—', moneda: op.moneda || 'USD', cantidad: 0, costoTotalUSD: 0 });
    }
    const pos = map.get(op.ticker)!;
    if (op.tipo === 'compra') {
      pos.cantidad += (op.cantidad || 0);
      pos.costoTotalUSD += op.monto_usd;
    } else if (op.tipo === 'venta' && pos.cantidad > 0) {
      const pct = Math.min((op.cantidad || 0) / pos.cantidad, 1);
      pos.costoTotalUSD *= (1 - pct);
      pos.cantidad -= (op.cantidad || 0);
    }
  }
  Array.from(map.keys()).forEach(k => { if (map.get(k)!.cantidad <= 0.000001) map.delete(k); });
  return map;
}

function calcularEfectivoUSD(ops: Operacion[]): number {
  let e = 0;
  for (const op of ops) {
    if (op.tipo === 'aportacion') e += op.monto_usd;
    else if (op.tipo === 'retiro')  e -= op.monto_usd;
    else if (op.tipo === 'compra')  e -= op.monto_usd;
    else if (op.tipo === 'venta')   e += op.monto_usd;
    else if (op.tipo === 'dividendo') e += op.monto_usd;
  }
  return Math.max(0, e);
}

async function fetchPrecio(ticker: string, mep: number): Promise<{ precioUSD: number | null; precioOriginal: number | null; moneda: string; variacion: number | null }> {
  try {
    const res = await fetch(`/api/buscar?ticker=${ticker}`);
    const data = await res.json();
    if (data.error) return { precioUSD: null, precioOriginal: null, moneda: 'USD', variacion: null };
    let precioOriginal: number | null = null, moneda = 'USD', variacion: number | null = null;
    if (data.tipo === 'cedear') { precioOriginal = data.precio?.valor ?? null; moneda = data.precio?.moneda || 'ARS'; variacion = data.precio?.variacion ?? null; }
    else if (data.tipo === 'renta_variable') { precioOriginal = data.precio ?? null; moneda = data.monedaLabel || 'USD'; variacion = data.variacion ?? null; }
    else if (data.tipo === 'renta_fija') { precioOriginal = data.precio?.valor ?? null; moneda = data.monedaLabel || 'USD'; variacion = data.precio?.variacion ?? null; }
    const precioUSD = precioOriginal != null ? (moneda === 'ARS' ? precioOriginal / mep : precioOriginal) : null;
    return { precioUSD, precioOriginal, moneda, variacion };
  } catch { return { precioUSD: null, precioOriginal: null, moneda: 'USD', variacion: null }; }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricaCard({ label, value, sub, subColor, valueColor, accent, small }: { label: string; value: string; sub?: string; subColor?: string; valueColor?: string; accent?: boolean; small?: boolean }) {
  return (
    <div className="card" style={{ borderColor: accent ? 'rgba(124,58,237,0.4)' : undefined }}>
      <div className="label-xs" style={{ marginBottom: '8px' }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: small ? '20px' : '26px', fontWeight: 600, color: valueColor || 'var(--text)', lineHeight: 1, marginBottom: '4px' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: subColor || 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{sub}</div>}
    </div>
  );
}

function DistChart({ title, data, total }: { title: string; data: { name: string; value: number }[]; total: number }) {
  if (!data.length) return null;
  return (
    <div className="card">
      <div className="label-xs" style={{ marginBottom: '16px' }}>{title}</div>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <PieChart width={150} height={150}>
          <Pie data={data} cx={70} cy={70} innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value">
            {data.map((_, i) => <Cell key={i} fill={DIST_COLORS[i % DIST_COLORS.length]} stroke="transparent" />)}
          </Pie>
          <Tooltip formatter={(v: number) => [`${fmtUSD(v)} (${(v / total * 100).toFixed(1)}%)`, '']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' }} />
        </PieChart>
        <div style={{ flex: 1, minWidth: '120px' }}>
          {data.slice(0, 8).map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: DIST_COLORS[i % DIST_COLORS.length], flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1, fontFamily: 'DM Sans, sans-serif' }}>{d.name}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)', minWidth: '40px', textAlign: 'right' }}>{(d.value / total * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabPosiciones({ posiciones, efectivoUSD, mep }: { posiciones: PosicionCompleta[]; efectivoUSD: number; mep: number }) {
  const totalActivosUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const valorTotalUSD = totalActivosUSD + efectivoUSD;
  const totalCostoUSD = posiciones.reduce((s, p) => s + p.costoTotalUSD, 0);
  const totalPnlUSD = posiciones.reduce((s, p) => s + (p.pnlUSD || 0), 0);
  const totalPnlPct = totalCostoUSD > 0 ? (totalPnlUSD / totalCostoUSD) * 100 : 0;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {['Activo', 'Precio', 'Cantidad', 'Costo Prom.', 'Valor Actual', 'P&L USD', 'P&L %', 'Var. Hoy', 'Tipo', 'Broker'].map(h => (
                <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: h === 'Activo' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posiciones.map((p, i) => (
              <tr key={p.ticker} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>{p.ticker}</div>
                  {p.nombre !== p.ticker && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Sans, sans-serif' }}>{p.nombre}</div>}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {p.loadingPrecio ? <span style={{ color: 'var(--muted)' }}>...</span> : (
                    <div>
                      <div style={{ color: 'var(--text)' }}>{p.precioActual != null ? (p.moneda === 'ARS' ? fmtARS(p.precioActual) : fmtUSD(p.precioActual)) : '—'}</div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{p.moneda}</div>
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text2)' }}>{fmtNum(p.cantidad, 4)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text2)' }}>{fmtUSD(p.costoPromedioUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text)', fontWeight: 500 }}>{p.loadingPrecio ? '...' : fmtUSD(p.valorActualUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.pnlUSD), fontWeight: 500 }}>{p.loadingPrecio ? '...' : p.pnlUSD != null ? (p.pnlUSD >= 0 ? '+' : '') + fmtUSD(p.pnlUSD) : '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.pnlPct), fontWeight: 600 }}>{p.loadingPrecio ? '...' : fmtPct(p.pnlPct)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.variacionDiaria) }}>{p.loadingPrecio ? '...' : fmtPct(p.variacionDiaria)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <span style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--violet-light)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px' }}>{TIPO_LABELS[p.tipo_activo] || p.tipo_activo}</span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted2)', fontSize: '12px' }}>{p.broker}</td>
              </tr>
            ))}
            {efectivoUSD > 0 && (
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,182,212,0.03)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: '#06b6d4' }}>Efectivo</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Liquidez disponible</div>
                </td>
                <td colSpan={3} />
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#06b6d4', fontWeight: 500 }}>{fmtUSD(efectivoUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}><span style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4', borderRadius: '4px', padding: '2px 6px', fontSize: '10px' }}>Efectivo</span></td>
                <td />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
              <td style={{ padding: '12px 16px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text)', fontSize: '14px' }}>Total</td>
              <td colSpan={3} />
              <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--text)', fontSize: '14px' }}>{fmtUSD(valorTotalUSD)}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: colorV(totalPnlUSD), fontSize: '14px' }}>{totalPnlUSD >= 0 ? '+' : ''}{fmtUSD(totalPnlUSD)}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: colorV(totalPnlPct), fontSize: '14px' }}>{fmtPct(totalPnlPct)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function TabDistribucion({ posiciones, efectivoUSD }: { posiciones: PosicionCompleta[]; efectivoUSD: number }) {
  const valorTotalUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0) + efectivoUSD;
  const byTicker = [
    ...posiciones.filter(p => p.valorActualUSD != null).map(p => ({ name: p.ticker, value: p.valorActualUSD! })).sort((a, b) => b.value - a.value),
    ...(efectivoUSD > 0 ? [{ name: 'Efectivo', value: efectivoUSD }] : []),
  ];
  const byTipo = posiciones.reduce((acc, p) => {
    const tipo = TIPO_LABELS[p.tipo_activo] || p.tipo_activo;
    const ex = acc.find(a => a.name === tipo);
    if (ex) ex.value += p.valorActualUSD || 0;
    else acc.push({ name: tipo, value: p.valorActualUSD || 0 });
    return acc;
  }, [] as { name: string; value: number }[]);
  if (efectivoUSD > 0) byTipo.push({ name: 'Efectivo', value: efectivoUSD });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <DistChart title="🥧 Distribución por activo" data={byTicker} total={valorTotalUSD} />
      <DistChart title="📦 Distribución por tipo" data={byTipo.sort((a,b) => b.value - a.value)} total={valorTotalUSD} />
    </div>
  );
}

function TabOperaciones({ operaciones, onDelete }: { operaciones: Operacion[]; onDelete: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div className="label-xs">📝 Historial de operaciones</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{operaciones.length} operaciones registradas</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {['Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio Unit.', 'Monto USD', 'Moneda', 'Broker', ''].map(h => (
                <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...operaciones].reverse().map((op, i) => (
              <tr key={op.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '10px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {new Date(op.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{ color: TIPO_COLORS_OP[op.tipo] || 'var(--text)', fontWeight: 600, textTransform: 'capitalize' }}>{op.tipo}</span>
                </td>
                <td style={{ padding: '10px 16px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text)' }}>{op.ticker}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text2)' }}>{op.cantidad != null ? fmtNum(op.cantidad, 4) : '—'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text2)' }}>
                  {op.precio_unitario != null ? (op.moneda === 'ARS' ? fmtARS(op.precio_unitario) : fmtUSD(op.precio_unitario)) : '—'}
                </td>
                <td style={{ padding: '10px 16px', color: 'var(--text)', fontWeight: 500 }}>{fmtUSD(op.monto_usd)}</td>
                <td style={{ padding: '10px 16px', color: 'var(--muted2)' }}>{op.moneda}</td>
                <td style={{ padding: '10px 16px', color: 'var(--muted2)' }}>{op.broker || '—'}</td>
                <td style={{ padding: '10px 16px' }}>
                  {confirmDelete === op.id ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => { onDelete(op.id); setConfirmDelete(null); }} style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Sí</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px' }}>No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(op.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModalAgregarOp({ mep, onClose, onSave }: { mep: number; onClose: () => void; onSave: (op: any) => Promise<void> }) {
  const [tipo, setTipo] = useState<'compra' | 'venta' | 'aportacion' | 'retiro' | 'dividendo'>('compra');
  const [ticker, setTicker] = useState('');
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [cantidad, setCantidad] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [moneda, setMoneda] = useState<'USD' | 'ARS'>('USD');
  const [tipoActivo, setTipoActivo] = useState('cedear');
  const [broker, setBroker] = useState('');
  const [notas, setNotas] = useState('');
  const [montoDirecto, setMontoDirecto] = useState('');
  const [saving, setSaving] = useState(false);

  const esCashOp = tipo === 'aportacion' || tipo === 'retiro';
  const esDividendo = tipo === 'dividendo';

  const calcMontoUSD = () => {
    if (esCashOp || esDividendo) {
      const m = parseFloat(montoDirecto);
      return isNaN(m) ? 0 : moneda === 'ARS' ? m / mep : m;
    }
    const q = parseFloat(cantidad), p = parseFloat(precioUnitario);
    if (isNaN(q) || isNaN(p)) return 0;
    return moneda === 'ARS' ? (q * p) / mep : q * p;
  };

  const montoUSDPreview = calcMontoUSD();

  const handleSave = async () => {
    const monto_usd = calcMontoUSD();
    if (monto_usd <= 0) return;
    setSaving(true);
    await onSave({
      fecha,
      ticker: esCashOp ? 'EFECTIVO' : ticker.toUpperCase().trim(),
      nombre: esCashOp ? (tipo === 'aportacion' ? 'Aportación' : 'Retiro') : (nombre || ticker.toUpperCase().trim()),
      tipo,
      cantidad: (esCashOp || esDividendo) ? null : parseFloat(cantidad) || null,
      precio_unitario: (esCashOp || esDividendo) ? null : parseFloat(precioUnitario) || null,
      monto_usd,
      moneda,
      tipo_activo: esCashOp ? 'efectivo' : tipoActivo,
      broker: broker || null,
      notas: notas || null,
    });
    setSaving(false);
  };

  const canSave = esCashOp || esDividendo
    ? parseFloat(montoDirecto) > 0
    : ticker.trim() && parseFloat(cantidad) > 0 && parseFloat(precioUnitario) > 0;

  const labelStyle = { display: 'block' as const, marginBottom: '6px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '520px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>Agregar operación</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={20} /></button>
        </div>

        {/* Tipo */}
        <div style={{ marginBottom: '16px' }}>
          <div className="label-xs" style={labelStyle}>Tipo de operación</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { key: 'compra', label: '🛒 Compra' },
              { key: 'venta', label: '💸 Venta' },
              { key: 'aportacion', label: '💵 Aportación' },
              { key: 'retiro', label: '🏦 Retiro' },
              { key: 'dividendo', label: '🎁 Dividendo' },
            ].map(t => (
              <button key={t.key} onClick={() => setTipo(t.key as any)}
                style={{ background: tipo === t.key ? 'var(--violet)' : 'var(--surface2)', color: tipo === t.key ? '#fff' : 'var(--text2)', border: `1px solid ${tipo === t.key ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="label-xs" style={labelStyle}>Fecha</div>
            <input className="input-field" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          {!esCashOp && (
            <>
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="label-xs" style={labelStyle}>Ticker</div>
                <input className="input-field" placeholder="AAPL, GD35, GGAL, NVDAD..." value={ticker} onChange={e => { setTicker(e.target.value.toUpperCase()); setNombre(e.target.value.toUpperCase()); }} />
              </div>
              {!esDividendo && (
                <>
                  <div>
                    <div className="label-xs" style={labelStyle}>Cantidad</div>
                    <input className="input-field" type="number" placeholder="0" value={cantidad} onChange={e => setCantidad(e.target.value)} min="0" step="any" />
                  </div>
                  <div>
                    <div className="label-xs" style={labelStyle}>Precio unitario</div>
                    <input className="input-field" type="number" placeholder="0.00" value={precioUnitario} onChange={e => setPrecioUnitario(e.target.value)} min="0" step="any" />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="label-xs" style={labelStyle}>Tipo de activo</div>
                    <select className="input-field" value={tipoActivo} onChange={e => setTipoActivo(e.target.value)} style={{ cursor: 'pointer' }}>
                      <option value="cedear">CEDEAR</option>
                      <option value="accion_ar">Acción Argentina</option>
                      <option value="bono">Bono Soberano</option>
                      <option value="on">Obligación Negociable</option>
                      <option value="etf">ETF</option>
                      <option value="crypto">Crypto</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                </>
              )}
            </>
          )}

          {(esCashOp || esDividendo) && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="label-xs" style={labelStyle}>Monto {esDividendo ? 'del dividendo' : ''}</div>
              <input className="input-field" type="number" placeholder="0.00" value={montoDirecto} onChange={e => setMontoDirecto(e.target.value)} min="0" step="any" />
            </div>
          )}

          <div>
            <div className="label-xs" style={labelStyle}>Moneda</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {['USD', 'ARS'].map(m => (
                <button key={m} onClick={() => setMoneda(m as any)} style={{ flex: 1, background: moneda === m ? 'var(--violet)' : 'var(--surface2)', color: moneda === m ? '#fff' : 'var(--text2)', border: `1px solid ${moneda === m ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>{m}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="label-xs" style={labelStyle}>Broker</div>
            <input className="input-field" placeholder="IOL, Balanz, Cocos..." value={broker} onChange={e => setBroker(e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="label-xs" style={labelStyle}>Notas (opcional)</div>
            <input className="input-field" placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} />
          </div>
        </div>

        {montoUSDPreview > 0 && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text2)' }}>Equivalente en USD</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', fontWeight: 600, color: 'var(--violet-light)' }}>{fmtUSD(montoUSDPreview)}</span>
          </div>
        )}
        {moneda === 'ARS' && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>
            Conversión usando MEP actual: ${mep.toLocaleString('es-AR')}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !canSave} className="btn-primary" style={{ flex: 2, padding: '10px', fontSize: '14px' }}>
            {saving ? 'Guardando...' : 'Guardar operación'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
      <div style={{ fontSize: '40px', marginBottom: '16px' }}>💼</div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>Tu portfolio está vacío</div>
      <div style={{ fontSize: '13px', color: 'var(--muted2)', maxWidth: '400px', margin: '0 auto 24px' }}>
        Agregá tus operaciones de compra, venta y aportaciones para ver el análisis completo de tu cartera.
      </div>
      <button onClick={onAdd} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}>
        <Plus size={16} /> Agregar primera operación
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type Tab = 'posiciones' | 'distribucion' | 'operaciones';

export default function PortfolioPage() {
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [posiciones, setPosiciones] = useState<PosicionCompleta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mep, setMep] = useState(1430);
  const [tab, setTab] = useState<Tab>('posiciones');
  const [showModal, setShowModal] = useState(false);
  const [efectivoUSD, setEfectivoUSD] = useState(0);
  const [totalInvertidoUSD, setTotalInvertidoUSD] = useState(0);
  const [xirr, setXirr] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/dolar').then(r => r.json()).then((data: any[]) => {
      if (Array.isArray(data)) {
        const bolsa = data.find(d => d.casa === 'bolsa');
        if (bolsa?.venta) setMep(bolsa.venta);
      }
    }).catch(() => {});
  }, []);

  const loadOperaciones = useCallback(async (): Promise<Operacion[]> => {
    const { data, error } = await supabase.from('operaciones').select('*').order('fecha', { ascending: true });
    if (error) { console.error(error); return []; }
    return data as Operacion[];
  }, []);

  const buildPositions = useCallback(async (ops: Operacion[], mepRate: number) => {
    const posMap = calcularPosicionesBase(ops);
    const efectivo = calcularEfectivoUSD(ops);
    const totalInv = ops.filter(o => o.tipo === 'aportacion').reduce((s, o) => s + o.monto_usd, 0)
                   - ops.filter(o => o.tipo === 'retiro').reduce((s, o) => s + o.monto_usd, 0);
    setEfectivoUSD(efectivo);
    setTotalInvertidoUSD(totalInv);

    const posArray: PosicionCompleta[] = Array.from(posMap.values()).map(pos => ({
      ...pos,
      costoPromedioUSD: pos.cantidad > 0 ? pos.costoTotalUSD / pos.cantidad : 0,
      precioActual: null, valorActualUSD: null, pnlUSD: null, pnlPct: null,
      variacionDiaria: null, loadingPrecio: true,
    }));
    setPosiciones([...posArray]);

    const results = await Promise.all(posArray.map(async (pos, idx) => {
      const { precioUSD, precioOriginal, moneda, variacion } = await fetchPrecio(pos.ticker, mepRate);
      const valorActualUSD = precioUSD != null ? precioUSD * pos.cantidad : null;
      const pnlUSD = valorActualUSD != null ? valorActualUSD - pos.costoTotalUSD : null;
      const pnlPct = pnlUSD != null && pos.costoTotalUSD > 0 ? (pnlUSD / pos.costoTotalUSD) * 100 : null;
      return { idx, precioActual: precioOriginal, moneda: moneda as 'ARS' | 'USD', valorActualUSD, pnlUSD, pnlPct, variacion };
    }));

    const completed = posArray.map((pos, idx) => {
      const r = results.find(x => x.idx === idx);
      if (!r) return { ...pos, loadingPrecio: false };
      return { ...pos, ...r, loadingPrecio: false };
    });
    setPosiciones(completed);

    const totalActivos = completed.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
    setXirr(calcularXIRR(ops, totalActivos + efectivo));
  }, []);

  const loadData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    const ops = await loadOperaciones();
    setOperaciones(ops);
    if (ops.length > 0) await buildPositions(ops, mep);
    if (refresh) setRefreshing(false); else setLoading(false);
  }, [mep, loadOperaciones, buildPositions]);

  useEffect(() => { loadData(); }, [mep]);

  const totalActivosUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const valorTotalUSD = totalActivosUSD + efectivoUSD;
  const gananciaNeta = valorTotalUSD - totalInvertidoUSD;
  const gananciaNetaPct = totalInvertidoUSD > 0 ? (gananciaNeta / totalInvertidoUSD) * 100 : 0;
  const variacionHoy = posiciones.reduce((s, p) => {
    if (p.variacionDiaria != null && p.valorActualUSD != null) {
      return s + p.valorActualUSD - (p.valorActualUSD / (1 + p.variacionDiaria / 100));
    }
    return s;
  }, 0);
  const variacionHoyPct = (valorTotalUSD - variacionHoy) > 0 ? (variacionHoy / (valorTotalUSD - variacionHoy)) * 100 : 0;
  const sorted = posiciones.filter(p => p.pnlPct != null).sort((a, b) => b.pnlPct! - a.pnlPct!);
  const mejorActivo = sorted.at(0) || null;
  const peorActivo = sorted.at(-1) || null;
  const byValue = posiciones.filter(p => p.valorActualUSD != null).sort((a, b) => b.valorActualUSD! - a.valorActualUSD!);
  const top3Val = byValue.slice(0, 3).reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const concentracion = valorTotalUSD > 0 ? (top3Val / valorTotalUSD) * 100 : 0;

  if (loading) return (
    <div style={{ maxWidth: '1100px', marginTop: '60px', textAlign: 'center' }}>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando portfolio...</div>
    </div>
  );

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Portfolio</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Vista consolidada de posiciones, liquidez y rendimiento.</div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => loadData(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> Agregar operación
          </button>
        </div>
      </div>

      {operaciones.length === 0 ? <EmptyState onAdd={() => setShowModal(true)} /> : (
        <>
          {/* Metrics row 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <MetricaCard label="CAPITAL ACTUAL" value={fmtUSD(valorTotalUSD)} sub={`Hoy ${variacionHoy >= 0 ? '+' : ''}${fmtUSD(variacionHoy)} (${fmtPct(variacionHoyPct)})`} subColor={colorV(variacionHoyPct)} accent />
            <MetricaCard label="TOTAL APORTADO" value={fmtUSD(totalInvertidoUSD)} sub="Capital neto aportado" />
            <MetricaCard label="GANANCIA NETA" value={(gananciaNeta >= 0 ? '+' : '') + fmtUSD(gananciaNeta)} sub={`${fmtPct(gananciaNetaPct)} retorno total`} subColor={colorV(gananciaNeta)} valueColor={colorV(gananciaNeta)} />
          </div>

          {/* Metrics row 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <MetricaCard label="TIR ANUALIZADA" small value={xirr != null ? (xirr >= 0 ? '+' : '') + xirr.toFixed(1) + '%' : '—'} sub="XIRR sobre flujos reales" valueColor={xirr != null ? colorV(xirr) : 'var(--text)'} />
            <MetricaCard label="TOTAL EN ACTIVOS" small value={fmtUSD(totalActivosUSD)} sub={`${posiciones.length} posición${posiciones.length !== 1 ? 'es' : ''}`} />
            <MetricaCard label="TOTAL EN LIQUIDEZ" small value={fmtUSD(efectivoUSD)} sub="Efectivo disponible" valueColor="#06b6d4" />
            <MetricaCard label="CONCENTRACIÓN" small value={`${concentracion.toFixed(0)}%`} sub={`top 3: ${byValue.slice(0,3).map(p=>p.ticker).join(', ')}`} valueColor={concentracion > 70 ? 'var(--red)' : concentracion > 50 ? 'var(--amber)' : 'var(--green)'} />
          </div>

          {/* Mejor / peor */}
          {(mejorActivo || peorActivo) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {mejorActivo && (
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(34,197,94,0.2)' }}>
                  <TrendingUp size={20} color="var(--green)" />
                  <div>
                    <div className="label-xs" style={{ marginBottom: '2px' }}>MEJOR ACTIVO</div>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--green)', marginRight: '8px' }}>{mejorActivo.ticker}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: 'var(--green)' }}>{fmtPct(mejorActivo.pnlPct)}</span>
                  </div>
                </div>
              )}
              {peorActivo && peorActivo.ticker !== mejorActivo?.ticker && (
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(244,63,94,0.2)' }}>
                  <TrendingDown size={20} color="var(--red)" />
                  <div>
                    <div className="label-xs" style={{ marginBottom: '2px' }}>PEOR ACTIVO</div>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--red)', marginRight: '8px' }}>{peorActivo.ticker}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: 'var(--red)' }}>{fmtPct(peorActivo.pnlPct)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px' }}>
            {[
              { key: 'posiciones' as Tab,   label: 'Posiciones',  icon: '📋' },
              { key: 'distribucion' as Tab, label: 'Distribución', icon: '🥧' },
              { key: 'operaciones' as Tab,  label: 'Operaciones', icon: '📝' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tab === t.key ? 'var(--violet)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted2)', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {tab === 'posiciones'  && <TabPosiciones posiciones={posiciones} efectivoUSD={efectivoUSD} mep={mep} />}
          {tab === 'distribucion' && <TabDistribucion posiciones={posiciones} efectivoUSD={efectivoUSD} />}
          {tab === 'operaciones' && (
            <TabOperaciones
              operaciones={operaciones}
              onDelete={async (id) => {
                await supabase.from('operaciones').delete().eq('id', id);
                await loadData(true);
              }}
            />
          )}
        </>
      )}

      {showModal && (
        <ModalAgregarOp
          mep={mep}
          onClose={() => setShowModal(false)}
          onSave={async (op) => {
            await supabase.from('operaciones').insert(op);
            setShowModal(false);
            await loadData(true);
          }}
        />
      )}
    </div>
  );
}

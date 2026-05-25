'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, X, TrendingUp, TrendingDown, Wand2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

interface Operacion {
  id: string; fecha: string; ticker: string; nombre: string | null;
  tipo: 'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro';
  cantidad: number | null; precio_unitario: number | null; monto_usd: number;
  moneda: 'ARS' | 'USD'; tipo_activo: string | null; sector: string | null;
  broker: string | null; notas: string | null;
}
interface PosicionBase {
  ticker: string; nombre: string; tipo_activo: string; sector: string;
  broker: string; moneda: 'ARS' | 'USD'; cantidad: number; costoTotalUSD: number;
}
interface PosicionCompleta extends PosicionBase {
  costoPromedioUSD: number; precioActual: number | null; valorActualUSD: number | null;
  pnlUSD: number | null; pnlPct: number | null; variacionDiaria: number | null; loadingPrecio: boolean;
}

const fmtUSD = (n: number | null, dec = 2) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtNum = (n: number | null, dec = 2) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const TIPO_LABELS: Record<string, string> = { cedear: 'CEDEAR', accion_ar: 'Acción AR', bono: 'Bono', on: 'ON', etf: 'ETF', crypto: 'Crypto', efectivo: 'Efectivo', otro: 'Otro' };
const TIPO_COLORS_OP: Record<string, string> = { compra: 'var(--green)', venta: 'var(--red)', dividendo: 'var(--violet-light)', deposito: '#06b6d4', retiro: 'var(--amber)' };
const DIST_COLORS = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#a3e635'];
const SECTORES = ['Tecnología','Financiero','Energía','Consumo masivo','Salud','Industria','Materiales','Inmobiliario','Telecomunicaciones','Cripto','Renta Fija Soberana','Renta Fija Corporativa','ETF Diversificado','Otro'];

function calcularCAGR(operaciones: Operacion[], valorActualUSD: number): number | null {
  const compras = operaciones.filter(o => o.tipo === 'compra');
  if (!compras.length || valorActualUSD <= 0) return null;
  const totalCosto = compras.reduce((s, o) => s + o.monto_usd, 0);
  if (totalCosto <= 0) return null;
  const sorted = [...compras].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const primera = new Date(sorted[0].fecha + 'T12:00:00');
  const anos = (Date.now() - primera.getTime()) / (365.25 * 86400000);
  if (anos < 0.02) return null;
  return +(((Math.pow(valorActualUSD / totalCosto, 1 / anos)) - 1) * 100).toFixed(2);
}

function pnlColor(pct: number | null): string {
  if (pct == null) return '#475569';
  if (pct >= 30) return '#15803d'; if (pct >= 15) return '#22c55e';
  if (pct >= 5)  return '#86efac'; if (pct >= -5)  return '#64748b';
  if (pct >= -15) return '#f87171'; if (pct >= -30) return '#ef4444';
  return '#991b1b';
}

function calcularPosicionesBase(ops: Operacion[]): Map<string, PosicionBase> {
  const map = new Map<string, PosicionBase>();
  for (const op of ops.filter(o => o.tipo === 'compra' || o.tipo === 'venta')) {
    if (!map.has(op.ticker)) {
      map.set(op.ticker, { ticker: op.ticker, nombre: op.nombre || op.ticker, tipo_activo: op.tipo_activo || 'otro', sector: op.sector || 'Otro', broker: op.broker || '—', moneda: op.moneda || 'USD', cantidad: 0, costoTotalUSD: 0 });
    }
    const pos = map.get(op.ticker)!;
    if (op.tipo === 'compra') { pos.cantidad += (op.cantidad || 0); pos.costoTotalUSD += op.monto_usd; }
    else if (op.tipo === 'venta' && pos.cantidad > 0) {
      const pct = Math.min((op.cantidad || 0) / pos.cantidad, 1);
      pos.costoTotalUSD *= (1 - pct); pos.cantidad -= (op.cantidad || 0);
    }
  }
  Array.from(map.keys()).forEach(k => { if (map.get(k)!.cantidad <= 0.000001) map.delete(k); });
  return map;
}

function calcularEfectivoUSD(ops: Operacion[]): number {
  let e = 0;
  for (const op of ops) {
    if (op.tipo === 'deposito') e += op.monto_usd;
    else if (op.tipo === 'retiro')    e -= op.monto_usd;
    else if (op.tipo === 'compra')    e -= op.monto_usd;
    else if (op.tipo === 'venta')     e += op.monto_usd;
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
              <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1 }}>{d.name}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)', minWidth: '40px', textAlign: 'right' }}>{(d.value / total * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabPosiciones({ posiciones, efectivoUSD }: { posiciones: PosicionCompleta[]; efectivoUSD: number }) {
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
              {['Activo','Precio','Cantidad','Costo Prom.','Valor Actual','P&L USD','P&L %','Var. Hoy','Sector','Broker'].map(h => (
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
                  <span style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--violet-light)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', whiteSpace: 'nowrap' }}>{p.sector || 'Otro'}</span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted2)', fontSize: '12px' }}>{p.broker}</td>
              </tr>
            ))}
            {efectivoUSD > 0 && (
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,182,212,0.03)' }}>
                <td style={{ padding: '12px 16px' }}><div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: '#06b6d4' }}>Liquidez</div><div style={{ fontSize: '11px', color: 'var(--muted)' }}>Efectivo disponible</div></td>
                <td colSpan={3} />
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#06b6d4', fontWeight: 500 }}>{fmtUSD(efectivoUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}><span style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4', borderRadius: '4px', padding: '2px 6px', fontSize: '10px' }}>Liquidez</span></td>
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

function TabMapa({ posiciones }: { posiciones: PosicionCompleta[] }) {
  const data = posiciones
    .filter(p => p.valorActualUSD != null && p.valorActualUSD > 0)
    .map(p => ({ name: p.ticker, value: p.valorActualUSD!, pnlPct: p.pnlPct ?? 0 }))
    .sort((a, b) => b.value - a.value);

  if (!data.length) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px', fontFamily: 'DM Mono, monospace' }}>No hay posiciones con valor calculado.</div>;

  const total = data.reduce((s, d) => s + d.value, 0);
  const mitad = Math.ceil(data.length / 2);
  const row1 = data.slice(0, mitad);
  const row2 = data.slice(mitad);
  const row1Pct = total > 0 ? (row1.reduce((s, d) => s + d.value, 0) / total) * 100 : 60;

  const renderItem = (d: { name: string; value: number; pnlPct: number }) => {
    const pct = (d.value / total) * 100;
    return (
      <div key={d.name} style={{ flex: `${d.value} 0 0`, background: pnlColor(d.pnlPct), borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px', minWidth: '40px', overflow: 'hidden' }}>
        <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'Syne, sans-serif', fontSize: `${Math.min(16, Math.max(9, pct * 0.9))}px`, textAlign: 'center' }}>{d.name}</span>
        {pct > 4 && <span style={{ color: 'rgba(255,255,255,0.85)', fontFamily: 'DM Mono, monospace', fontSize: `${Math.min(12, Math.max(8, pct * 0.7))}px`, marginTop: '4px' }}>{d.pnlPct >= 0 ? '+' : ''}{d.pnlPct.toFixed(1)}%</span>}
        {pct > 10 && <span style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'DM Mono, monospace', fontSize: '10px', marginTop: '2px' }}>{fmtUSD(d.value)}</span>}
      </div>
    );
  };

  return (
    <div className="card">
      <div style={{ marginBottom: '14px' }}>
        <div className="label-xs" style={{ marginBottom: '6px' }}>🗺️ Mapa de posiciones</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Tamaño = valor actual · Color = P&L estimado</div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {[['#15803d','+30%+'],['#22c55e','+15%'],['#86efac','+5%'],['#64748b','0%'],['#f87171','-5%'],['#ef4444','-15%'],['#991b1b','-30%']].map(([c,l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: c }} />
            <span style={{ fontSize: '10px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', height: '340px' }}>
        <div style={{ display: 'flex', gap: '4px', flex: row1Pct }}>{row1.map(d => renderItem(d))}</div>
        {row2.length > 0 && <div style={{ display: 'flex', gap: '4px', flex: 100 - row1Pct }}>{row2.map(d => renderItem(d))}</div>}
      </div>
    </div>
  );
}

function TabDistribucion({ posiciones, efectivoUSD }: { posiciones: PosicionCompleta[]; efectivoUSD: number }) {
  const valorTotalUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0) + efectivoUSD;
  const byTicker = [
    ...posiciones.filter(p => p.valorActualUSD != null).map(p => ({ name: p.ticker, value: p.valorActualUSD! })).sort((a, b) => b.value - a.value),
    ...(efectivoUSD > 0 ? [{ name: 'Liquidez', value: efectivoUSD }] : []),
  ];
  const bySector = posiciones.reduce((acc, p) => {
    const s = p.sector || 'Otro';
    const ex = acc.find(a => a.name === s);
    if (ex) ex.value += p.valorActualUSD || 0; else acc.push({ name: s, value: p.valorActualUSD || 0 });
    return acc;
  }, [] as { name: string; value: number }[]);
  if (efectivoUSD > 0) bySector.push({ name: 'Liquidez', value: efectivoUSD });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <DistChart title="🥧 Distribución por activo" data={byTicker} total={valorTotalUSD} />
      <DistChart title="🏭 Distribución por sector" data={bySector.sort((a, b) => b.value - a.value)} total={valorTotalUSD} />
    </div>
  );
}

function TabRiesgo({ posiciones, valorTotalUSD }: { posiciones: PosicionCompleta[]; valorTotalUSD: number }) {
  const bySector = posiciones.reduce((acc, p) => {
    const s = p.sector || 'Otro';
    const ex = acc.find(a => a.name === s);
    const val = p.valorActualUSD || 0;
    if (ex) ex.value += val; else acc.push({ name: s, value: val });
    return acc;
  }, [] as { name: string; value: number }[]).sort((a, b) => b.value - a.value);

  const sorted = [...posiciones].filter(p => p.pnlPct != null).sort((a, b) => b.pnlPct! - a.pnlPct!);
  const top3 = sorted.slice(0, Math.min(3, sorted.length));
  const bot3 = sorted.slice(-Math.min(3, sorted.length)).reverse();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <div className="card">
        <div className="label-xs" style={{ marginBottom: '16px' }}>🏭 Exposición sectorial</div>
        {bySector.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Agregá operaciones con sector para ver la exposición.</div>}
        {bySector.map((s, i) => {
          const pct = valorTotalUSD > 0 ? (s.value / valorTotalUSD) * 100 : 0;
          return (
            <div key={s.name} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text2)', fontFamily: 'DM Sans, sans-serif' }}>{s.name}</span>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)' }}>{fmtUSD(s.value)}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)', fontWeight: 600, minWidth: '44px', textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: DIST_COLORS[i % DIST_COLORS.length], borderRadius: '3px' }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '14px' }}>🏆 Mejor performance</div>
          {top3.map((p, i) => (
            <div key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: i < top3.length - 1 ? '8px' : '0', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--green)', flexShrink: 0 }}>{i + 1}</div>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)', flex: 1 }}>{p.ticker}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--green)', fontWeight: 600 }}>{fmtPct(p.pnlPct)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '14px' }}>📉 Peor performance</div>
          {bot3.map((p, i) => (
            <div key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: i < bot3.length - 1 ? '8px' : '0', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>{i + 1}</div>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)', flex: 1 }}>{p.ticker}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: colorV(p.pnlPct), fontWeight: 600 }}>{fmtPct(p.pnlPct)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabHistorial({ operaciones, mep }: { operaciones: Operacion[]; mep: number }) {
  const [datos, setDatos] = useState<{ fecha: string; valor: number; invertido: number; rendimiento: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const build = async () => {
      setLoading(true); setError('');
      try {
        const tickers = Array.from(new Set(operaciones.filter(o => o.tipo === 'compra' || o.tipo === 'venta').map(o => o.ticker)));
        if (!tickers.length) { setLoading(false); return; }

        const historicos: Record<string, { fecha: string; cierre: number }[]> = {};
        await Promise.all(tickers.map(async ticker => {
          try {
            const base = ticker.endsWith('D') && ticker.length > 2 ? ticker.slice(0, -1) : ticker;
            const res = await fetch(`/api/historico?ticker=${base}&suffix=&range=1y`);
            const data = await res.json();
            if (!data.error && data.precios?.length) historicos[ticker] = data.precios;
          } catch {}
        }));

        if (!Object.keys(historicos).length) { setError('No se pudo obtener datos históricos.'); setLoading(false); return; }

        const allDates = new Set<string>();
        Object.values(historicos).forEach(h => h.forEach(p => allDates.add(p.fecha)));
        const firstCompra = operaciones.filter(o => o.tipo === 'compra').sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
        const startDate = firstCompra?.fecha || '';
        const sortedDates = [...allDates].sort().filter(d => d >= startDate);

        const puntos = sortedDates.map(fecha => {
          const opsUpTo = operaciones.filter(o => o.fecha <= fecha);
          const posMap = calcularPosicionesBase(opsUpTo);
          let valor = 0;
          for (const pos of posMap.values()) {
            const h = historicos[pos.ticker];
            if (!h?.length) continue;
            const available = h.filter(p => p.fecha <= fecha);
            if (!available.length) continue;
            const price = available[available.length - 1].cierre;
            valor += (pos.moneda === 'ARS' ? price / mep : price) * pos.cantidad;
          }
          const depositos = opsUpTo.filter(o => o.tipo === 'deposito').reduce((s, o) => s + o.monto_usd, 0);
          const retiros   = opsUpTo.filter(o => o.tipo === 'retiro').reduce((s, o) => s + o.monto_usd, 0);
          const compras   = opsUpTo.filter(o => o.tipo === 'compra').reduce((s, o) => s + o.monto_usd, 0);
          const ventas    = opsUpTo.filter(o => o.tipo === 'venta').reduce((s, o) => s + o.monto_usd, 0);
          valor += Math.max(0, depositos + ventas - compras - retiros);
          const invertido = compras;
          const rendimiento = invertido > 0 ? +((valor - invertido) / invertido * 100).toFixed(2) : 0;
          return { fecha, valor: Math.round(valor * 100) / 100, invertido: Math.round(invertido * 100) / 100, rendimiento };
        }).filter(p => p.valor > 0);

        setDatos(puntos);
      } catch { setError('Error al cargar los datos históricos.'); }
      setLoading(false);
    };
    build();
  }, [operaciones, mep]);

  if (loading) return (
    <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando datos históricos...</div>
      <div style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '8px', fontFamily: 'DM Mono, monospace' }}>Esto puede tardar unos segundos</div>
    </div>
  );

  if (error || !datos.length) return (
    <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{error || 'No hay datos históricos suficientes.'}</div>
    </div>
  );

  const display = datos.filter((_, i) => i % Math.max(1, Math.floor(datos.length / 80)) === 0 || i === datos.length - 1);
  const fin = datos[datos.length - 1];
  const inicio = datos[0];
  const rendimientoActual = fin.rendimiento;
  const variacionCapital = inicio.valor > 0 ? ((fin.valor - inicio.valor) / inicio.valor * 100) : 0;

  const xAxisProps = {
    dataKey: 'fecha',
    tick: { fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' },
    tickFormatter: (v: string) => { const d = new Date(v + 'T00:00:00'); return `${d.toLocaleString('es-AR', { month: 'short' })} ${d.getFullYear().toString().slice(2)}`; },
    interval: 'preserveStartEnd' as const,
  };

  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' };
  const labelFmt = (v: string) => new Date(v + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Gráfico 1 — Evolución del capital */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div className="label-xs" style={{ marginBottom: '4px' }}>💰 Evolución del capital</div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Valor del portfolio vs capital invertido en USD</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>{fmtUSD(fin.valor)}</div>
            <div style={{ fontSize: '11px', color: colorV(variacionCapital), fontFamily: 'DM Mono, monospace' }}>
              {variacionCapital >= 0 ? '+' : ''}{variacionCapital.toFixed(1)}% en el período
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={display} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
              tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} width={55} />
            <Tooltip contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [fmtUSD(v), name === 'valor' ? 'Portfolio' : 'Invertido']}
              labelFormatter={labelFmt} />
            <Line type="monotone" dataKey="valor" stroke="#7c3aed" strokeWidth={2} dot={false} name="valor" />
            <Line type="monotone" dataKey="invertido" stroke="#06b6d4" strokeWidth={1.5} dot={false} strokeDasharray="5 4" name="invertido" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '20px', height: '2px', background: '#7c3aed' }} />
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Valor portfolio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '20px', height: '0', borderTop: '2px dashed #06b6d4' }} />
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Capital invertido</span>
          </div>
        </div>
      </div>

      {/* Gráfico 2 — Evolución del rendimiento */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div className="label-xs" style={{ marginBottom: '4px' }}>📈 Evolución del rendimiento</div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Retorno porcentual acumulado sobre capital invertido</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', fontWeight: 700, color: colorV(rendimientoActual) }}>
              {rendimientoActual >= 0 ? '+' : ''}{rendimientoActual.toFixed(2)}%
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>rendimiento actual</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={display} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
              tickFormatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`} width={55} />
            <Tooltip contentStyle={tooltipStyle}
              formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, 'Rendimiento']}
              labelFormatter={labelFmt} />
            <Line type="monotone" dataKey="rendimiento"
              stroke={rendimientoActual >= 0 ? '#22c55e' : '#ef4444'}
              strokeWidth={2} dot={false} name="rendimiento" />
          </LineChart>
        </ResponsiveContainer>
      </div>

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
              {['Fecha','Tipo','Ticker','Cantidad','Precio Unit.','Monto USD','Moneda','Sector','Broker',''].map(h => (
                <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...operaciones].reverse().map((op, i) => (
              <tr key={op.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '10px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{new Date(op.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ padding: '10px 16px' }}><span style={{ color: TIPO_COLORS_OP[op.tipo] || 'var(--text)', fontWeight: 600, textTransform: 'capitalize' }}>{op.tipo}</span></td>
                <td style={{ padding: '10px 16px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text)' }}>{op.ticker}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text2)' }}>{op.cantidad != null ? fmtNum(op.cantidad, 4) : '—'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text2)' }}>{op.precio_unitario != null ? (op.moneda === 'ARS' ? fmtARS(op.precio_unitario) : fmtUSD(op.precio_unitario)) : '—'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text)', fontWeight: 500 }}>{fmtUSD(op.monto_usd)}</td>
                <td style={{ padding: '10px 16px', color: 'var(--muted2)' }}>{op.moneda}</td>
                <td style={{ padding: '10px 16px', color: 'var(--muted2)', fontSize: '12px' }}>{op.sector || '—'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--muted2)' }}>{op.broker || '—'}</td>
                <td style={{ padding: '10px 16px' }}>
                  {confirmDelete === op.id ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => { onDelete(op.id); setConfirmDelete(null); }} style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Sí</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px' }}>No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(op.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center' }}><Trash2 size={14} /></button>
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
  const [tipo, setTipo] = useState<'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro'>('compra');
  const [ticker, setTicker] = useState('');
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [cantidad, setCantidad] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [moneda, setMoneda] = useState<'USD' | 'ARS'>('USD');
  const [tipoActivo, setTipoActivo] = useState('cedear');
  const [sector, setSector] = useState('Tecnología');
  const [broker, setBroker] = useState('');
  const [notas, setNotas] = useState('');
  const [montoDirecto, setMontoDirecto] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingSector, setLoadingSector] = useState(false);
  const [sectorDetectado, setSectorDetectado] = useState(false);

  const isAssetOp = tipo === 'compra' || tipo === 'venta';
  const isCashOp  = tipo === 'deposito' || tipo === 'retiro' || tipo === 'dividendo';

  useEffect(() => {
    if (!ticker || ticker.length < 2 || !isAssetOp) { setSectorDetectado(false); return; }
    const timer = setTimeout(async () => {
      setLoadingSector(true);
      try {
        const res = await fetch(`/api/perfil?ticker=${ticker}`);
        const data = await res.json();
        if (!data.error && data.sector) { setSector(data.sector); setSectorDetectado(true); }
        if (!data.error && data.nombre && !nombre) setNombre(data.nombre);
      } catch {}
      setLoadingSector(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [ticker, isAssetOp]);

  const calcMontoUSD = () => {
    if (isCashOp) { const m = parseFloat(montoDirecto); return isNaN(m) ? 0 : moneda === 'ARS' ? m / mep : m; }
    const q = parseFloat(cantidad), p = parseFloat(precioUnitario);
    if (isNaN(q) || isNaN(p)) return 0;
    return moneda === 'ARS' ? (q * p) / mep : q * p;
  };

  const montoUSDPreview = calcMontoUSD();
  const canSave = isCashOp
    ? parseFloat(montoDirecto) > 0
    : ticker.trim() && parseFloat(cantidad) > 0 && parseFloat(precioUnitario) > 0;

  const handleSave = async () => {
    const monto_usd = calcMontoUSD();
    if (monto_usd <= 0) return;
    setSaving(true);
    const tickerFinal = isAssetOp || tipo === 'dividendo' ? ticker.toUpperCase().trim() : 'EFECTIVO';
    await onSave({
      fecha, ticker: tickerFinal,
      nombre: isAssetOp ? (nombre || tickerFinal) : tipo === 'dividendo' ? tickerFinal : (tipo === 'deposito' ? 'Depósito' : 'Retiro'),
      tipo,
      cantidad: isAssetOp ? parseFloat(cantidad) || null : null,
      precio_unitario: isAssetOp ? parseFloat(precioUnitario) || null : null,
      monto_usd, moneda,
      tipo_activo: isAssetOp ? tipoActivo : 'efectivo',
      sector: isAssetOp ? sector : null,
      broker: broker || null, notas: notas || null,
    });
    setSaving(false);
  };

  const ls = { display: 'block' as const, marginBottom: '6px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '540px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>Agregar operación</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={20} /></button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div className="label-xs" style={ls}>Tipo de operación</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { key: 'compra',   label: '🛒 Compra' },
              { key: 'venta',    label: '💸 Venta' },
              { key: 'dividendo',label: '🎁 Dividendo' },
              { key: 'deposito', label: '💵 Depósito' },
              { key: 'retiro',   label: '🏦 Retiro' },
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
            <div className="label-xs" style={ls}>Fecha</div>
            <input className="input-field" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          {(isAssetOp || tipo === 'dividendo') && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="label-xs" style={ls}>Ticker</div>
              <div style={{ position: 'relative' }}>
                <input className="input-field" placeholder="AAPL, GD35, GGAL, NVDAD..."
                  value={ticker} onChange={e => { setTicker(e.target.value.toUpperCase()); setSectorDetectado(false); }} />
                {loadingSector && <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', border: '2px solid var(--violet)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
              </div>
              {sectorDetectado && <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--green)', fontFamily: 'DM Mono, monospace' }}>✓ Sector detectado automáticamente</div>}
            </div>
          )}

          {isAssetOp && (
            <>
              <div>
                <div className="label-xs" style={ls}>Cantidad</div>
                <input className="input-field" type="number" placeholder="0" value={cantidad} onChange={e => setCantidad(e.target.value)} min="0" step="any" />
              </div>
              <div>
                <div className="label-xs" style={ls}>Precio unitario</div>
                <input className="input-field" type="number" placeholder="0.00" value={precioUnitario} onChange={e => setPrecioUnitario(e.target.value)} min="0" step="any" />
              </div>
              <div>
                <div className="label-xs" style={ls}>Tipo de activo</div>
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
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span className="label-xs" style={{ margin: 0 }}>Sector</span>
                  {loadingSector && <span style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>detectando...</span>}
                  {sectorDetectado && <span style={{ fontSize: '10px', color: 'var(--green)', fontFamily: 'DM Mono, monospace' }}>✓ auto</span>}
                </div>
                <select className="input-field" value={sector} onChange={e => setSector(e.target.value)} style={{ cursor: 'pointer' }}>
                  {SECTORES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}

          {isCashOp && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="label-xs" style={ls}>Monto</div>
              <input className="input-field" type="number" placeholder="0.00" value={montoDirecto} onChange={e => setMontoDirecto(e.target.value)} min="0" step="any" />
            </div>
          )}

          <div>
            <div className="label-xs" style={ls}>Moneda</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {['USD','ARS'].map(m => (
                <button key={m} onClick={() => setMoneda(m as any)}
                  style={{ flex: 1, background: moneda === m ? 'var(--violet)' : 'var(--surface2)', color: moneda === m ? '#fff' : 'var(--text2)', border: `1px solid ${moneda === m ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label-xs" style={ls}>Broker</div>
            <input className="input-field" placeholder="IOL, Balanz, Cocos..." value={broker} onChange={e => setBroker(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="label-xs" style={ls}>Notas (opcional)</div>
            <input className="input-field" placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} />
          </div>
        </div>

        {montoUSDPreview > 0 && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text2)' }}>Equivalente en USD</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', fontWeight: 600, color: 'var(--violet-light)' }}>{fmtUSD(montoUSDPreview)}</span>
          </div>
        )}
        {moneda === 'ARS' && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Conversión usando MEP actual: ${mep.toLocaleString('es-AR')}</div>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !canSave} className="btn-primary" style={{ flex: 2, padding: '10px', fontSize: '14px' }}>{saving ? 'Guardando...' : 'Guardar operación'}</button>
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
      <div style={{ fontSize: '13px', color: 'var(--muted2)', maxWidth: '400px', margin: '0 auto 24px' }}>Agregá tus operaciones de compra y venta para ver el análisis completo de tu cartera.</div>
      <button onClick={onAdd} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}><Plus size={16} /> Agregar primera operación</button>
    </div>
  );
}

type Tab = 'posiciones' | 'mapa' | 'distribucion' | 'riesgo' | 'historial' | 'operaciones';

export default function PortfolioPage() {
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [posiciones, setPosiciones] = useState<PosicionCompleta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actualizandoSectores, setActualizandoSectores] = useState(false);
  const [mep, setMep] = useState(1430);
  const [tab, setTab] = useState<Tab>('posiciones');
  const [showModal, setShowModal] = useState(false);
  const [efectivoUSD, setEfectivoUSD] = useState(0);
  const [totalInvertidoUSD, setTotalInvertidoUSD] = useState(0);
  const [xirr, setXirr] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/dolar').then(r => r.json()).then((data: any[]) => {
      if (Array.isArray(data)) { const bolsa = data.find(d => d.casa === 'bolsa'); if (bolsa?.venta) setMep(bolsa.venta); }
    }).catch(() => {});
  }, []);

  const loadOperaciones = useCallback(async (): Promise<Operacion[]> => {
    const { data, error } = await supabase.from('operaciones').select('*').order('fecha', { ascending: true });
    if (error) { console.error(error); return []; }
    return data as Operacion[];
  }, []);

  const buildPositions = useCallback(async (ops: Operacion[], mepRate: number) => {
    const posMap = calcularPosicionesBase(ops);
    const totalInv = ops.filter(o => o.tipo === 'compra').reduce((s, o) => s + o.monto_usd, 0);
    const efectivo = calcularEfectivoUSD(ops);
    setTotalInvertidoUSD(totalInv);
    setEfectivoUSD(efectivo);

    const posArray: PosicionCompleta[] = Array.from(posMap.values()).map(pos => ({
      ...pos, costoPromedioUSD: pos.cantidad > 0 ? pos.costoTotalUSD / pos.cantidad : 0,
      precioActual: null, valorActualUSD: null, pnlUSD: null, pnlPct: null, variacionDiaria: null, loadingPrecio: true,
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
    setXirr(calcularCAGR(ops, totalActivos));
  }, []);

  const loadData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    const ops = await loadOperaciones();
    setOperaciones(ops);
    if (ops.length > 0) await buildPositions(ops, mep);
    if (refresh) setRefreshing(false); else setLoading(false);
  }, [mep, loadOperaciones, buildPositions]);

  useEffect(() => { loadData(); }, [mep]);

  // Actualizar sectores automáticamente para todas las posiciones existentes
  const actualizarTodosSectores = async () => {
    setActualizandoSectores(true);
    const tickers = [...new Set(posiciones.map(p => p.ticker))];
    for (const ticker of tickers) {
      try {
        const res = await fetch(`/api/perfil?ticker=${ticker}`);
        const data = await res.json();
        if (!data.error && data.sector) {
          await supabase.from('operaciones').update({ sector: data.sector }).eq('ticker', ticker);
        }
      } catch {}
    }
    await loadData(true);
    setActualizandoSectores(false);
  };

  const totalActivosUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const valorTotalUSD = totalActivosUSD + efectivoUSD;
  const gananciaNeta = valorTotalUSD - totalInvertidoUSD;
  const gananciaNetaPct = totalInvertidoUSD > 0 ? (gananciaNeta / totalInvertidoUSD) * 100 : 0;
  const variacionHoy = posiciones.reduce((s, p) => {
    if (p.variacionDiaria != null && p.valorActualUSD != null) return s + p.valorActualUSD - (p.valorActualUSD / (1 + p.variacionDiaria / 100));
    return s;
  }, 0);
  const variacionHoyPct = (valorTotalUSD - variacionHoy) > 0 ? (variacionHoy / (valorTotalUSD - variacionHoy)) * 100 : 0;
  const sortedByVal = posiciones.filter(p => p.valorActualUSD != null).sort((a, b) => b.valorActualUSD! - a.valorActualUSD!);
  const top3Val = sortedByVal.slice(0, 3).reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const concentracion = valorTotalUSD > 0 ? (top3Val / valorTotalUSD) * 100 : 0;
  const sortedByPnl = posiciones.filter(p => p.pnlPct != null).sort((a, b) => b.pnlPct! - a.pnlPct!);
  const mejorActivo = sortedByPnl.at(0) || null;
  const peorActivo = sortedByPnl.at(-1) || null;

  if (loading) return <div style={{ maxWidth: '1100px', marginTop: '60px', textAlign: 'center' }}><div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando portfolio...</div></div>;

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Portfolio</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Vista consolidada de posiciones, liquidez y rendimiento.</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {posiciones.length > 0 && (
            <button onClick={actualizarTodosSectores} disabled={actualizandoSectores}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
              <Wand2 size={14} /> {actualizandoSectores ? 'Detectando...' : 'Auto-sectores'}
            </button>
          )}
          <button onClick={() => loadData(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> Agregar operación
          </button>
        </div>
      </div>

      {operaciones.length === 0 ? <EmptyState onAdd={() => setShowModal(true)} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <MetricaCard label="CAPITAL ACTUAL" value={fmtUSD(valorTotalUSD)} sub={`Hoy ${variacionHoy >= 0 ? '+' : ''}${fmtUSD(variacionHoy)} (${fmtPct(variacionHoyPct)})`} subColor={colorV(variacionHoyPct)} accent />
            <MetricaCard label="TOTAL INVERTIDO" value={fmtUSD(totalInvertidoUSD)} sub="Suma de compras realizadas" />
            <MetricaCard label="GANANCIA NETA" value={(gananciaNeta >= 0 ? '+' : '') + fmtUSD(gananciaNeta)} sub={`${fmtPct(gananciaNetaPct)} retorno total`} subColor={colorV(gananciaNeta)} valueColor={colorV(gananciaNeta)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <MetricaCard label="TIR ANUALIZADA" small value={xirr != null ? (xirr >= 0 ? '+' : '') + xirr.toFixed(1) + '%' : '—'} sub="CAGR desde primera compra" valueColor={xirr != null ? colorV(xirr) : 'var(--text)'} />
            <MetricaCard label="TOTAL EN ACTIVOS" small value={fmtUSD(totalActivosUSD)} sub={`${posiciones.length} posición${posiciones.length !== 1 ? 'es' : ''}`} />
            <MetricaCard label="TOTAL EN LIQUIDEZ" small value={fmtUSD(efectivoUSD)} sub="Efectivo disponible" valueColor="#06b6d4" />
            <MetricaCard label="CONCENTRACIÓN" small value={`${concentracion.toFixed(0)}%`} sub={`top 3: ${sortedByVal.slice(0, 3).map(p => p.ticker).join(', ')}`} valueColor={concentracion > 70 ? 'var(--red)' : concentracion > 50 ? 'var(--amber)' : 'var(--green)'} />
          </div>

          {(mejorActivo || peorActivo) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {mejorActivo && (
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(34,197,94,0.2)' }}>
                  <TrendingUp size={20} color="var(--green)" />
                  <div><div className="label-xs" style={{ marginBottom: '2px' }}>MEJOR ACTIVO</div><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--green)', marginRight: '8px' }}>{mejorActivo.ticker}</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: 'var(--green)' }}>{fmtPct(mejorActivo.pnlPct)}</span></div>
                </div>
              )}
              {peorActivo && peorActivo.ticker !== mejorActivo?.ticker && (
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(244,63,94,0.2)' }}>
                  <TrendingDown size={20} color="var(--red)" />
                  <div><div className="label-xs" style={{ marginBottom: '2px' }}>PEOR ACTIVO</div><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--red)', marginRight: '8px' }}>{peorActivo.ticker}</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: colorV(peorActivo.pnlPct) }}>{fmtPct(peorActivo.pnlPct)}</span></div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px', overflowX: 'auto' }}>
            {[
              { key: 'posiciones' as Tab,   label: 'Posiciones',  icon: '📋' },
              { key: 'mapa' as Tab,         label: 'Mapa',         icon: '🗺️' },
              { key: 'distribucion' as Tab, label: 'Distribución', icon: '🥧' },
              { key: 'riesgo' as Tab,       label: 'Exposición',   icon: '🏭' },
              { key: 'historial' as Tab,    label: 'Historial',    icon: '📈' },
              { key: 'operaciones' as Tab,  label: 'Operaciones',  icon: '📝' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tab === t.key ? 'var(--violet)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted2)', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {tab === 'posiciones'   && <TabPosiciones posiciones={posiciones} efectivoUSD={efectivoUSD} />}
          {tab === 'mapa'         && <TabMapa posiciones={posiciones} />}
          {tab === 'distribucion' && <TabDistribucion posiciones={posiciones} efectivoUSD={efectivoUSD} />}
          {tab === 'riesgo'       && <TabRiesgo posiciones={posiciones} valorTotalUSD={valorTotalUSD} />}
          {tab === 'historial'    && <TabHistorial operaciones={operaciones} mep={mep} />}
          {tab === 'operaciones'  && <TabOperaciones operaciones={operaciones} onDelete={async (id) => { await supabase.from('operaciones').delete().eq('id', id); await loadData(true); }} />}
        </>
      )}

      {showModal && (
        <ModalAgregarOp mep={mep} onClose={() => setShowModal(false)}
          onSave={async (op) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { alert('Sesión expirada.'); return; }
            const { error } = await supabase.from('operaciones').insert({ ...op, user_id: user.id });
            if (error) { alert('Error: ' + error.message); return; }
            setShowModal(false);
            await loadData(true);
          }}
        />
      )}
    </div>
  );
}

'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, RefreshCw, X, TrendingUp, TrendingDown, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Operacion {
  id: string; fecha: string; ticker: string; nombre: string | null;
  tipo: 'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro';
  cantidad: number | null; precio_unitario: number | null; monto_usd: number;
  moneda: 'ARS' | 'USD'; tipo_activo: string | null;
  broker: string | null; notas: string | null;
}
interface PosicionBase {
  ticker: string; nombre: string; tipo_activo: string;
  broker: string; moneda: 'ARS' | 'USD'; cantidad: number; costoTotalUSD: number;
}
interface PosicionCompleta extends PosicionBase {
  costoPromedioUSD: number; precioActual: number | null; valorActualUSD: number | null;
  pnlUSD: number | null; pnlPct: number | null; variacionDiaria: number | null;
  loadingPrecio: boolean; esVencido?: boolean;
}
interface GananciaRealizada {
  ticker: string; nombre: string; tipo_activo: string;
  montoVentaUSD: number; costoRealizadoUSD: number;
  gananciaUSD: number; gananciaPct: number;
  cantidadVendida: number; vencido?: boolean;
}
interface OpImportada {
  importId: string;
  fecha: string; ticker: string; nombre: string | null;
  tipo: 'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro';
  cantidad: number | null; precio_unitario: number | null; monto_usd: number;
  moneda: 'ARS' | 'USD'; tipo_activo: string | null;
  broker: string | null; notas: string | null;
  isDuplicate: boolean; selected: boolean;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtUSD = (n: number | null, dec = 2) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtNum = (n: number | null, dec = 2) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const TIPO_LABELS: Record<string, string> = { cedear: 'CEDEAR', accion_ar: 'Acción AR', bono: 'Bono', on: 'ON', etf: 'ETF', crypto: 'Crypto', efectivo: 'Efectivo', otro: 'Otro' };
const TIPO_COLORS_OP: Record<string, string> = { compra: 'var(--green)', venta: 'var(--red)', dividendo: 'var(--violet-light)', deposito: '#06b6d4', retiro: 'var(--amber)' };
const DIST_COLORS = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#a3e635'];

// ─── Constantes de activos ────────────────────────────────────────────────────

const NO_NORMALIZAR_D = new Set(['YPFD', 'NDD']);
const BONOS_SET = new Set(['AL29','AL30','AL35','AL41','GD29','GD30','GD35','GD38','GD41','GD46','AE38','GK17','NDF','NDB','NDA','NDS','NDG','DICP','CUAP','DICA','BPY26','BPJ28','BPD29','TX24','TX26','TX28','LECAP','LECER','BONTE','PR15','PR13']);
const AR_STOCKS = new Set(['GGAL','YPFD','PAMP','TXAR','ALUA','BMA','LOMA','TECO','CEPU','VALO','CRES','IRCP','METR','COME','HARG','RICH','AGRO','SEMI','SUPV','BBAR','BYMA','NQNF','OEST']);

function normalizarTicker(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (NO_NORMALIZAR_D.has(upper)) return upper;
  if (upper.endsWith('D') && upper.length > 2) return upper.slice(0, -1);
  return upper;
}

// ─── Helpers de cálculo ───────────────────────────────────────────────────────

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
  if (pct >= 5) return '#86efac'; if (pct >= -5) return '#64748b';
  if (pct >= -15) return '#f87171'; if (pct >= -30) return '#ef4444';
  return '#991b1b';
}

function calcularPosicionesBase(ops: Operacion[]): Map<string, PosicionBase> {
  const map = new Map<string, PosicionBase>();
  for (const op of ops.filter(o => o.tipo === 'compra' || o.tipo === 'venta')) {
    const tickerKey = normalizarTicker(op.ticker);
    if (!map.has(tickerKey)) {
      map.set(tickerKey, { ticker: tickerKey, nombre: op.nombre || tickerKey, tipo_activo: op.tipo_activo || 'otro', broker: op.broker || '—', moneda: op.moneda || 'USD', cantidad: 0, costoTotalUSD: 0 });
    }
    const pos = map.get(tickerKey)!;
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
    else if (op.tipo === 'retiro') e -= op.monto_usd;
    else if (op.tipo === 'compra') e -= op.monto_usd;
    else if (op.tipo === 'venta') e += op.monto_usd;
    else if (op.tipo === 'dividendo') e += op.monto_usd;
  }
  return Math.max(0, e);
}

function calcularGananciasRealizadas(ops: Operacion[], vencimientosMap: Record<string, string> = {}): GananciaRealizada[] {
  const bases = new Map<string, { costoTotal: number; cantidad: number; nombre: string; tipo_activo: string }>();
  const realizadasMap = new Map<string, GananciaRealizada>();

  for (const op of ops.filter(o => o.tipo === 'compra' || o.tipo === 'venta')) {
    const key = normalizarTicker(op.ticker);
    if (!bases.has(key)) bases.set(key, { costoTotal: 0, cantidad: 0, nombre: op.nombre || key, tipo_activo: op.tipo_activo || 'otro' });
    const base = bases.get(key)!;
    if (op.tipo === 'compra') {
      base.costoTotal += op.monto_usd;
      base.cantidad += (op.cantidad || 0);
    } else if (op.tipo === 'venta' && base.cantidad > 0) {
      const cantVendida = Math.min(op.cantidad || 0, base.cantidad);
      const pct = cantVendida / base.cantidad;
      const costoVendido = base.costoTotal * pct;
      const ganancia = op.monto_usd - costoVendido;
      if (!realizadasMap.has(key)) {
        realizadasMap.set(key, { ticker: key, nombre: base.nombre, tipo_activo: base.tipo_activo, montoVentaUSD: 0, costoRealizadoUSD: 0, gananciaUSD: 0, gananciaPct: 0, cantidadVendida: 0 });
      }
      const real = realizadasMap.get(key)!;
      real.montoVentaUSD += op.monto_usd;
      real.costoRealizadoUSD += costoVendido;
      real.gananciaUSD += ganancia;
      real.cantidadVendida += cantVendida;
      base.costoTotal -= costoVendido;
      base.cantidad -= cantVendida;
    }
  }

  const hoy = new Date();
  for (const [key, base] of Array.from(bases.entries())) {
    if (base.cantidad <= 0.000001) continue;
    const venc = vencimientosMap[key];
    if (venc && new Date(venc) < hoy) {
      if (!realizadasMap.has(key)) {
        realizadasMap.set(key, { ticker: key, nombre: base.nombre, tipo_activo: base.tipo_activo, montoVentaUSD: 0, costoRealizadoUSD: base.costoTotal, gananciaUSD: 0, gananciaPct: 0, cantidadVendida: base.cantidad, vencido: true });
      }
      realizadasMap.get(key)!.vencido = true;
    }
  }

  return Array.from(realizadasMap.values())
    .map(r => ({ ...r, gananciaPct: r.costoRealizadoUSD > 0 ? (r.gananciaUSD / r.costoRealizadoUSD) * 100 : 0 }))
    .sort((a, b) => b.gananciaUSD - a.gananciaUSD);
}

async function fetchPrecio(ticker: string, mep: number): Promise<{ precioUSD: number | null; precioOriginal: number | null; moneda: string; variacion: number | null; vencimiento: string | null }> {
  try {
    const res = await fetch(`/api/buscar?ticker=${ticker}`);
    const data = await res.json();
    if (data.error) return { precioUSD: null, precioOriginal: null, moneda: 'USD', variacion: null, vencimiento: null };
    let precioOriginal: number | null = null, moneda = 'USD', variacion: number | null = null;
    if (data.tipo === 'cedear') { precioOriginal = data.precio?.valor ?? null; moneda = data.precio?.moneda || 'ARS'; variacion = data.precio?.variacion ?? null; }
    else if (data.tipo === 'renta_variable') { precioOriginal = data.precio ?? null; moneda = data.monedaLabel || 'USD'; variacion = data.variacion ?? null; }
    else if (data.tipo === 'renta_fija') { precioOriginal = data.precio?.valor ?? null; moneda = data.monedaLabel || 'USD'; variacion = data.precio?.variacion ?? null; }
    const precioUSD = precioOriginal != null ? (moneda === 'ARS' ? precioOriginal / mep : precioOriginal) : null;
    return { precioUSD, precioOriginal, moneda, variacion, vencimiento: data.spec?.vencimiento || null };
  } catch { return { precioUSD: null, precioOriginal: null, moneda: 'USD', variacion: null, vencimiento: null }; }
}

// ─── Parsers de importación ───────────────────────────────────────────────────

function detectTipoActivo(ticker: string, tipoInstrumento?: string | null): string {
  if (tipoInstrumento) {
    const t = tipoInstrumento.toLowerCase();
    if (t.includes('cedear')) return 'cedear';
    if (t.includes('accion') || t.includes('acción')) return 'accion_ar';
    if (t.includes('renta fija') || t.includes('bono') || t.includes('soberan') || t.includes('negociable')) return 'bono';
  }
  const upper = ticker.toUpperCase();
  const base = normalizarTicker(upper);
  if (BONOS_SET.has(upper) || BONOS_SET.has(base)) return 'bono';
  if (AR_STOCKS.has(upper) || AR_STOCKS.has(base)) return 'accion_ar';
  if (upper.endsWith('D') && upper.length > 2 && !NO_NORMALIZAR_D.has(upper)) return 'cedear';
  return 'cedear';
}

function parseIOLMonto(s: any): number {
  if (s == null) return 0;
  const str = String(s).trim();
  if (!str || str === '000' || str === '-' || str === 'NaN') return 0;
  const cleaned = str.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

function parseIOLDate(s: string): string {
  if (!s) return '';
  const parts = s.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

function parseIOLTipoMov(tipoMov: string): { tipo: 'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro'; ticker: string } | null {
  if (tipoMov.startsWith('Compra(')) return { tipo: 'compra', ticker: tipoMov.slice(7, -1).trim() };
  if (tipoMov.startsWith('Venta(')) return { tipo: 'venta', ticker: tipoMov.slice(6, -1).trim() };
  if (tipoMov.startsWith('Pago de Dividendos(')) {
    const inner = tipoMov.slice('Pago de Dividendos('.length, -1).replace(/ US\$$/, '').trim();
    return { tipo: 'dividendo', ticker: inner };
  }
  if (tipoMov.startsWith('Depósito de Fondos') || tipoMov.startsWith('Deposito de Fondos') || tipoMov === 'Crédito') return { tipo: 'deposito', ticker: 'EFECTIVO' };
  if (tipoMov.startsWith('Extracción de Fondos') || tipoMov.startsWith('Extraccion de Fondos')) return { tipo: 'retiro', ticker: 'EFECTIVO' };
  return null;
}

function parseIOL(html: string, mep: number): Omit<OpImportada, 'isDuplicate' | 'selected'>[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) throw new Error('No se encontró la tabla en el archivo IOL');
  const allRows = Array.from(table.querySelectorAll('tr'));
  if (!allRows.length) throw new Error('Tabla vacía');
  const headers = Array.from(allRows[0].querySelectorAll('th,td')).map(td => td.textContent?.trim() || '');
  const rawRows = allRows.slice(1).map(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  }).filter(r => r['Tipo Mov.']);

  const groups = new Map<string, typeof rawRows>();
  for (const row of rawRows) {
    const key = (row['Nro. de Boleto'] && String(row['Nro. de Boleto']).trim() !== '0')
      ? String(row['Nro. de Boleto']).trim()
      : String(row['Nro. de Mov.']).trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result: Omit<OpImportada, 'isDuplicate' | 'selected'>[] = [];
  for (const [boleto, rows] of Array.from(groups.entries())) {
    const tipoMov = rows[0]['Tipo Mov.'] || '';
    const opInfo = parseIOLTipoMov(tipoMov);
    if (!opInfo) continue;
    const { tipo, ticker } = opInfo;
    const esCash = tipo === 'deposito' || tipo === 'retiro';
    let moneda: 'USD' | 'ARS' = 'ARS', monto_usd = 0, precio_unitario: number | null = null, cantidad: number | null = null, fecha = '';
    if (esCash) {
      const row = rows[0];
      const montoARS = parseIOLMonto(row['Monto']);
      if (!montoARS) continue;
      monto_usd = montoARS / mep; moneda = 'ARS';
      fecha = parseIOLDate(row['Concert.'] || row['Liquid.']);
    } else {
      const usdRow = rows.find(r => (r['Tipo Cuenta'] || '').includes('Dolares') && parseIOLMonto(r['Monto']) > 0);
      const arsRow = rows.find(r => (r['Tipo Cuenta'] || '').includes('Pesos') && parseIOLMonto(r['Monto']) > 0);
      if (usdRow) {
        moneda = 'USD'; monto_usd = parseIOLMonto(usdRow['Monto']);
        precio_unitario = parseFloat(String(usdRow['Precio']).replace(',', '.')) || null;
        cantidad = parseFloat(usdRow['Cant. titulos']) || null;
        fecha = parseIOLDate(usdRow['Concert.'] || usdRow['Liquid.']);
      } else if (arsRow) {
        moneda = 'ARS';
        monto_usd = parseIOLMonto(arsRow['Monto']) / mep;
        precio_unitario = parseFloat(String(arsRow['Precio']).replace(',', '.')) || null;
        cantidad = parseFloat(arsRow['Cant. titulos']) || null;
        fecha = parseIOLDate(arsRow['Concert.'] || arsRow['Liquid.']);
      } else { continue; }
    }
    if (!monto_usd || !fecha) continue;
    const esCashOp = tipo === 'deposito' || tipo === 'retiro';
    result.push({
      importId: `IOL-${boleto}`, fecha,
      ticker: esCashOp ? 'EFECTIVO' : ticker,
      nombre: esCashOp ? (tipo === 'deposito' ? 'Depósito' : 'Retiro') : ticker,
      tipo, cantidad: esCashOp ? null : cantidad,
      precio_unitario: esCashOp ? null : precio_unitario,
      monto_usd, moneda,
      tipo_activo: esCashOp ? 'efectivo' : detectTipoActivo(ticker),
      broker: 'IOL', notas: null,
    });
  }
  return result;
}

function parseXLSXDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.split('T')[0];
    if (/^\d{2}\/\d{2}\/\d{4}/.test(val)) { const [d, m, y] = val.split('/'); return `${y}-${m}-${d}`; }
    return val;
  }
  if (typeof val === 'number') {
    try { const info = (XLSX.SSF as any).parse_date_code(val); return `${info.y}-${String(info.m).padStart(2, '0')}-${String(info.d).padStart(2, '0')}`; } catch { return ''; }
  }
  return '';
}

function parseBalanz(buffer: ArrayBuffer, mep: number): Omit<OpImportada, 'isDuplicate' | 'selected'>[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
  const boletoGroups = new Map<string, any[]>();
  const dividendRows: any[] = [];
  for (const row of rows) {
    const desc = String(row['Descripcion'] || '');
    const bm = desc.match(/^Boleto\s*\/\s*(\d+)\s*\/\s*(COMPRA|VENTA)\s*\/[^/]*\/\s*([A-Z0-9.]+)/i);
    if (bm) {
      const key = bm[1];
      if (!boletoGroups.has(key)) boletoGroups.set(key, []);
      boletoGroups.get(key)!.push({ ...row, _tipo: bm[2].toLowerCase(), _ticker: bm[3] });
      continue;
    }
    const dm = desc.match(/^Dividendo en efectivo\s*\/\s*(.+)/i);
    if (dm) dividendRows.push({ ...row, _ticker: dm[1].trim() });
  }
  const result: Omit<OpImportada, 'isDuplicate' | 'selected'>[] = [];
  for (const [boleto, rows] of Array.from(boletoGroups.entries())) {
    const { _tipo: tipo, _ticker: ticker } = rows[0];
    const tipoInstr = rows[0]['Tipo de Instrumento'] || null;
    const usdRow = rows.find(r => { const m = String(r['Moneda'] || ''); return (m.includes('Dólar') || m.includes('Dollar')) && Math.abs(r['Importe'] || 0) > 0; });
    const arsRow = rows.find(r => String(r['Moneda'] || '').includes('Pesos') && Math.abs(r['Importe'] || 0) > 0);
    const baseRow = usdRow || arsRow;
    if (!baseRow) continue;
    const esUSD = !!usdRow;
    const importe = Math.abs((esUSD ? usdRow : arsRow)!['Importe'] || 0);
    if (!importe) continue;
    const monto_usd = esUSD ? importe : importe / mep;
    const moneda: 'USD' | 'ARS' = esUSD ? 'USD' : 'ARS';
    const cantidad = Math.abs(baseRow['Cantidad'] || 0) || null;
    const precio = (baseRow['Precio'] > 0) ? baseRow['Precio'] : null;
    const fecha = parseXLSXDate(baseRow['Concertacion']);
    if (!fecha) continue;
    result.push({ importId: `BAL-${boleto}`, fecha, ticker, nombre: ticker, tipo: tipo as any, cantidad, precio_unitario: precio, monto_usd, moneda, tipo_activo: detectTipoActivo(ticker, tipoInstr), broker: 'Balanz', notas: null });
  }
  const divGrouped = new Map<string, any[]>();
  for (const row of dividendRows) {
    const fecha = parseXLSXDate(row['Concertacion']);
    const key = `${fecha}-${row['_ticker']}`;
    if (!divGrouped.has(key)) divGrouped.set(key, []);
    divGrouped.get(key)!.push(row);
  }
  for (const [key, rows] of Array.from(divGrouped.entries())) {
    const usdRow = rows.find(r => { const m = String(r['Moneda'] || ''); return (m.includes('Dólar') || m.includes('Dollar')) && (r['Importe'] || 0) > 0; });
    if (!usdRow) continue;
    const ticker = usdRow['_ticker'];
    const fecha = parseXLSXDate(usdRow['Concertacion']);
    const importe = usdRow['Importe'];
    if (!fecha || !importe) continue;
    result.push({ importId: `BAL-DIV-${key}`, fecha, ticker, nombre: ticker, tipo: 'dividendo', cantidad: null, precio_unitario: null, monto_usd: importe, moneda: 'USD', tipo_activo: detectTipoActivo(ticker, usdRow['Tipo de Instrumento']), broker: 'Balanz', notas: null });
  }
  return result.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function isDuplicateOp(op: Omit<OpImportada, 'isDuplicate' | 'selected'>, existing: Operacion[]): boolean {
  return existing.some(e => e.fecha === op.fecha && e.ticker === op.ticker && e.tipo === op.tipo && e.monto_usd > 0 && Math.abs(e.monto_usd - op.monto_usd) / e.monto_usd < 0.03);
}

// ─── Componentes UI base ──────────────────────────────────────────────────────

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

// ─── Tab: Posiciones ──────────────────────────────────────────────────────────

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
              {['Activo','Precio','Cantidad','Costo Prom.','Valor Actual','P&L USD','P&L %','Var. Hoy','Tipo','Broker'].map(h => (
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
                  {p.loadingPrecio ? <span style={{ color: 'var(--muted)' }}>...</span> : <div><div style={{ color: 'var(--text)' }}>{p.precioActual != null ? (p.moneda === 'ARS' ? fmtARS(p.precioActual) : fmtUSD(p.precioActual)) : '—'}</div><div style={{ fontSize: '10px', color: 'var(--muted)' }}>{p.moneda}</div></div>}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text2)' }}>{fmtNum(p.cantidad, 4)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text2)' }}>{fmtUSD(p.costoPromedioUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text)', fontWeight: 500 }}>{p.loadingPrecio ? '...' : fmtUSD(p.valorActualUSD)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.pnlUSD), fontWeight: 500 }}>{p.loadingPrecio ? '...' : p.pnlUSD != null ? (p.pnlUSD >= 0 ? '+' : '') + fmtUSD(p.pnlUSD) : '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.pnlPct), fontWeight: 600 }}>{p.loadingPrecio ? '...' : fmtPct(p.pnlPct)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(p.variacionDiaria) }}>{p.loadingPrecio ? '...' : fmtPct(p.variacionDiaria)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}><span style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--violet-light)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', whiteSpace: 'nowrap' }}>{TIPO_LABELS[p.tipo_activo] || p.tipo_activo}</span></td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted2)', fontSize: '12px' }}>{p.broker}</td>
              </tr>
            ))}
            {efectivoUSD > 0 && (
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,182,212,0.03)' }}>
                <td style={{ padding: '12px 16px' }}><div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: '#06b6d4' }}>Liquidez</div></td>
                <td colSpan={3} />
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#06b6d4', fontWeight: 500 }}>{fmtUSD(efectivoUSD)}</td>
                <td colSpan={3} style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--muted)' }}>—</td>
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

// ─── Tab: Mapa ────────────────────────────────────────────────────────────────

function TabMapa({ posiciones }: { posiciones: PosicionCompleta[] }) {
  const data = posiciones.filter(p => p.valorActualUSD != null && p.valorActualUSD > 0).map(p => ({ name: p.ticker, value: p.valorActualUSD!, pnlPct: p.pnlPct ?? 0 })).sort((a, b) => b.value - a.value);
  if (!data.length) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px', fontFamily: 'DM Mono, monospace' }}>No hay posiciones con valor calculado.</div>;
  const total = data.reduce((s, d) => s + d.value, 0);
  const mitad = Math.ceil(data.length / 2);
  const row1 = data.slice(0, mitad), row2 = data.slice(mitad);
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

// ─── Tab: Distribución ────────────────────────────────────────────────────────

function TabDistribucion({ posiciones, efectivoUSD }: { posiciones: PosicionCompleta[]; efectivoUSD: number }) {
  const valorTotalUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0) + efectivoUSD;
  const byTicker = [...posiciones.filter(p => p.valorActualUSD != null).map(p => ({ name: p.ticker, value: p.valorActualUSD! })).sort((a, b) => b.value - a.value), ...(efectivoUSD > 0 ? [{ name: 'Liquidez', value: efectivoUSD }] : [])];
  const byTipo = posiciones.reduce((acc, p) => { const tipo = TIPO_LABELS[p.tipo_activo] || p.tipo_activo; const ex = acc.find(a => a.name === tipo); if (ex) ex.value += p.valorActualUSD || 0; else acc.push({ name: tipo, value: p.valorActualUSD || 0 }); return acc; }, [] as { name: string; value: number }[]);
  if (efectivoUSD > 0) byTipo.push({ name: 'Liquidez', value: efectivoUSD });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <DistChart title="🥧 Por activo" data={byTicker} total={valorTotalUSD} />
      <DistChart title="📦 Por tipo" data={byTipo.sort((a, b) => b.value - a.value)} total={valorTotalUSD} />
    </div>
  );
}

// ─── Tab: Performance ─────────────────────────────────────────────────────────

function TabPerformance({ posiciones, realizadas }: { posiciones: PosicionCompleta[]; realizadas: GananciaRealizada[] }) {
  const totalRealizada = realizadas.reduce((s, r) => s + r.gananciaUSD, 0);
  const totalNoRealizada = posiciones.reduce((s, p) => s + (p.pnlUSD || 0), 0);
  const sortedPos = [...posiciones].filter(p => p.pnlPct != null).sort((a, b) => b.pnlPct! - a.pnlPct!);
  const top = sortedPos.slice(0, 5);
  const bot = sortedPos.slice(-5).reverse();

  const renderPosItem = (p: PosicionCompleta, i: number, isTop: boolean) => (
    <div key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: isTop ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: isTop ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>{i + 1}</div>
      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)', flex: 1 }}>{p.ticker}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--muted)' }}>{fmtUSD(p.pnlUSD)}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: colorV(p.pnlPct), fontWeight: 600 }}>{fmtPct(p.pnlPct)}</span>
    </div>
  );

  const renderRealItem = (r: GananciaRealizada, i: number) => (
    <div key={r.ticker} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: r.gananciaUSD >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: r.gananciaUSD >= 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>{i + 1}</div>
      <div style={{ flex: 1 }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{r.ticker}</span>
        {r.vencido && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '1px 5px' }}>vencido</span>}
      </div>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--muted)' }}>{fmtUSD(r.gananciaUSD)}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: colorV(r.gananciaUSD), fontWeight: 600 }}>{fmtPct(r.gananciaPct)}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="card" style={{ borderColor: totalNoRealizada >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)' }}>
          <div className="label-xs" style={{ marginBottom: '8px' }}>📊 NO REALIZADA</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '22px', fontWeight: 700, color: colorV(totalNoRealizada) }}>{totalNoRealizada >= 0 ? '+' : ''}{fmtUSD(totalNoRealizada)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>Ganancia/pérdida en posiciones abiertas</div>
        </div>
        <div className="card" style={{ borderColor: totalRealizada >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)' }}>
          <div className="label-xs" style={{ marginBottom: '8px' }}>✅ REALIZADA</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '22px', fontWeight: 700, color: colorV(totalRealizada) }}>{totalRealizada >= 0 ? '+' : ''}{fmtUSD(totalRealizada)}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>Ganancia/pérdida en posiciones cerradas</div>
        </div>
      </div>
      {sortedPos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="card"><div className="label-xs" style={{ marginBottom: '12px' }}>🏆 Mejor abierta</div>{top.map((p, i) => renderPosItem(p, i, true))}</div>
          <div className="card"><div className="label-xs" style={{ marginBottom: '12px' }}>📉 Peor abierta</div>{bot.map((p, i) => renderPosItem(p, i, false))}</div>
        </div>
      )}
      {realizadas.length > 0 && (
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '12px' }}>✅ Posiciones cerradas / realizadas</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              {realizadas.filter(r => r.gananciaUSD >= 0).map((r, i) => renderRealItem(r, i))}
              {realizadas.filter(r => r.gananciaUSD >= 0).length === 0 && <div style={{ color: 'var(--muted)', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}>Sin ganancias realizadas</div>}
            </div>
            <div>
              {realizadas.filter(r => r.gananciaUSD < 0).map((r, i) => renderRealItem(r, i))}
              {realizadas.filter(r => r.gananciaUSD < 0).length === 0 && <div style={{ color: 'var(--muted)', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}>Sin pérdidas realizadas</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Historial ───────────────────────────────────────────────────────────

function TabHistorial({ operaciones, mep, valorActualIol }: { operaciones: Operacion[]; mep: number; valorActualIol: number }) {
  const [datos, setDatos] = useState<{ fecha: string; valor: number; invertido: number; rendimiento: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const build = async () => {
      setLoading(true); setError('');
      try {
        const compras = operaciones.filter(o => o.tipo === 'compra');
        if (!compras.length) { setLoading(false); return; }
        const tickers = Array.from(new Set(compras.map(o => o.ticker)));
        const historicos: Record<string, { fecha: string; cierre: number }[]> = {};
        await Promise.all(tickers.map(async ticker => {
          try {
            const base = normalizarTicker(ticker);
            const res = await fetch(`/api/historico?ticker=${base}&suffix=&range=1y`);
            const data = await res.json();
            if (!data.error && data.historico?.length) historicos[ticker] = data.historico;
          } catch {}
        }));
        if (!Object.keys(historicos).length) { setError('No se pudo obtener datos históricos.'); setLoading(false); return; }
        const basePrices: Record<string, number> = {};
        for (const ticker of tickers) {
          const h = historicos[ticker];
          if (!h?.length) continue;
          const primeraCompra = compras.filter(o => o.ticker === ticker).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
          if (!primeraCompra) continue;
          const precioBase = h.filter(p => p.fecha <= primeraCompra.fecha).at(-1)?.cierre || h.find(p => p.fecha >= primeraCompra.fecha)?.cierre;
          if (precioBase) basePrices[ticker] = precioBase;
        }
        const primeraFecha = compras.sort((a, b) => a.fecha.localeCompare(b.fecha))[0].fecha;
        const allDates = new Set<string>();
        Object.values(historicos).forEach(h => h.forEach(p => allDates.add(p.fecha)));
        const sortedDates = Array.from(allDates).sort().filter(d => d >= primeraFecha);
        const puntos = sortedDates.map(fecha => {
          const opsUpTo = operaciones.filter(o => o.fecha <= fecha);
          const posMap = calcularPosicionesBase(opsUpTo);
          let valor = 0;
          for (const pos of Array.from(posMap.values())) {
            const h = historicos[pos.ticker];
            const basePrice = basePrices[pos.ticker];
            if (!h?.length || !basePrice) { valor += pos.costoTotalUSD; continue; }
            const precioFecha = h.filter(p => p.fecha <= fecha).at(-1)?.cierre;
            if (!precioFecha) { valor += pos.costoTotalUSD; continue; }
            valor += pos.costoTotalUSD * (precioFecha / basePrice);
          }
          valor += Math.max(0, calcularEfectivoUSD(opsUpTo));
          const invertido = opsUpTo.filter(o => o.tipo === 'compra').reduce((s, o) => s + o.monto_usd, 0);
          const rendimiento = invertido > 0 ? +((valor - invertido) / invertido * 100).toFixed(2) : 0;
          return { fecha, valor: Math.round(valor * 100) / 100, invertido, rendimiento };
        }).filter(p => p.valor > 0);
        if (puntos.length > 0 && valorActualIol > 0) {
          const ultimoValor = puntos[puntos.length - 1].valor;
          if (ultimoValor > 0) {
            const factor = valorActualIol / ultimoValor;
            puntos.forEach(p => { p.valor = Math.round(p.valor * factor * 100) / 100; p.rendimiento = p.invertido > 0 ? +((p.valor - p.invertido) / p.invertido * 100).toFixed(2) : 0; });
          }
        }
        const diaAntes = new Date(primeraFecha + 'T12:00:00');
        diaAntes.setDate(diaAntes.getDate() - 1);
        setDatos([{ fecha: diaAntes.toISOString().split('T')[0], valor: 0, invertido: 0, rendimiento: 0 }, ...puntos]);
      } catch { setError('Error al cargar los datos históricos.'); }
      setLoading(false);
    };
    build();
  }, [operaciones, mep, valorActualIol]);

  if (loading) return <div className="card" style={{ textAlign: 'center', padding: '60px' }}><div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando datos históricos...</div><div style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '8px', fontFamily: 'DM Mono, monospace' }}>Puede tardar unos segundos</div></div>;
  if (error || datos.length <= 1) return <div className="card" style={{ textAlign: 'center', padding: '60px' }}><div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{error || 'No hay datos históricos suficientes.'}</div></div>;

  const display = datos.filter((_, i) => i % Math.max(1, Math.floor(datos.length / 80)) === 0 || i === datos.length - 1);
  const fin = datos[datos.length - 1];
  const rendimientoActual = fin.rendimiento;
  const primerPuntoReal = datos.find(p => p.valor > 0);
  const variacionCapital = primerPuntoReal && primerPuntoReal.valor > 0 ? ((fin.valor - primerPuntoReal.valor) / primerPuntoReal.valor * 100) : 0;
  const primeraCompraFecha = operaciones.filter(o => o.tipo === 'compra').sort((a, b) => a.fecha.localeCompare(b.fecha))[0]?.fecha;
  const xAxisProps = { dataKey: 'fecha', tick: { fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }, tickFormatter: (v: string) => { const d = new Date(v + 'T00:00:00'); return `${d.toLocaleString('es-AR', { month: 'short' })} ${d.getFullYear().toString().slice(2)}`; }, interval: 'preserveStartEnd' as const };
  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' };
  const labelFmt = (v: string) => new Date(v + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <MetricaCard label="RETORNO TOTAL" small value={(rendimientoActual >= 0 ? '+' : '') + rendimientoActual.toFixed(2) + '%'} valueColor={colorV(rendimientoActual)} sub="Vs. capital invertido" />
        <MetricaCard label="VARIACIÓN PERÍODO" small value={(variacionCapital >= 0 ? '+' : '') + variacionCapital.toFixed(1) + '%'} valueColor={colorV(variacionCapital)} sub="Desde primera compra" />
        <MetricaCard label="PRIMERA INVERSIÓN" small value={primeraCompraFecha ? new Date(primeraCompraFecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} sub="Fecha de inicio del portfolio" />
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div><div className="label-xs" style={{ marginBottom: '4px' }}>💰 Evolución del capital</div><div style={{ fontSize: '12px', color: 'var(--muted)' }}>Anclado al valor actual · tendencia basada en el subyacente</div></div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '20px', height: '2px', background: '#7c3aed' }} /><span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Portfolio</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '20px', height: '0', borderTop: '2px dashed #06b6d4' }} /><span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Invertido</span></div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={display} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }} tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`} width={55} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [fmtUSD(v), name === 'valor' ? 'Portfolio' : 'Invertido']} labelFormatter={labelFmt} />
            <Line type="monotone" dataKey="valor" stroke="#7c3aed" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="invertido" stroke="#06b6d4" strokeWidth={1.5} dot={false} strokeDasharray="5 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div><div className="label-xs" style={{ marginBottom: '4px' }}>📈 Evolución del rendimiento</div><div style={{ fontSize: '12px', color: 'var(--muted)' }}>Retorno porcentual acumulado sobre capital invertido</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontFamily: 'DM Mono, monospace', fontSize: '20px', fontWeight: 700, color: colorV(rendimientoActual) }}>{rendimientoActual >= 0 ? '+' : ''}{rendimientoActual.toFixed(2)}%</div><div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>rendimiento actual</div></div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={display} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fill: 'var(--muted2)', fontSize: 10, fontFamily: 'DM Mono, monospace' }} tickFormatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`} width={55} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, 'Rendimiento']} labelFormatter={labelFmt} />
            <Line type="monotone" dataKey="rendimiento" stroke={rendimientoActual >= 0 ? '#22c55e' : '#ef4444'} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Operaciones ─────────────────────────────────────────────────────────

function TabOperaciones({ operaciones, onDelete, onImport }: { operaciones: Operacion[]; onDelete: (id: string) => void; onImport: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="label-xs">📝 Historial de operaciones</div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{operaciones.length} operaciones registradas</div>
        </div>
        <button onClick={onImport} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600 }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--violet)'; e.currentTarget.style.color = 'var(--violet-light)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}>
          <Upload size={14} /> Importar CSV
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {['Fecha','Tipo','Ticker','Cantidad','Precio Unit.','Monto USD','Moneda','Broker',''].map(h => (
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

// ─── Modal: Agregar operación ─────────────────────────────────────────────────

function ModalAgregarOp({ mep, onClose, onSave }: { mep: number; onClose: () => void; onSave: (op: any) => Promise<void> }) {
  const [tipo, setTipo] = useState<'compra' | 'venta' | 'dividendo' | 'deposito' | 'retiro'>('compra');
  const [ticker, setTicker] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [cantidad, setCantidad] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [moneda, setMoneda] = useState<'USD' | 'ARS'>('USD');
  const [tipoActivo, setTipoActivo] = useState('cedear');
  const [broker, setBroker] = useState('');
  const [notas, setNotas] = useState('');
  const [montoDirecto, setMontoDirecto] = useState('');
  const [saving, setSaving] = useState(false);
  const isAssetOp = tipo === 'compra' || tipo === 'venta';
  const isCashOp = tipo === 'deposito' || tipo === 'retiro' || tipo === 'dividendo';
  const calcMontoUSD = () => {
    if (isCashOp) { const m = parseFloat(montoDirecto); return isNaN(m) ? 0 : moneda === 'ARS' ? m / mep : m; }
    const q = parseFloat(cantidad), p = parseFloat(precioUnitario);
    if (isNaN(q) || isNaN(p)) return 0;
    return moneda === 'ARS' ? (q * p) / mep : q * p;
  };
  const montoUSDPreview = calcMontoUSD();
  const canSave = isCashOp ? parseFloat(montoDirecto) > 0 : ticker.trim() && parseFloat(cantidad) > 0 && parseFloat(precioUnitario) > 0;
  const handleSave = async () => {
    const monto_usd = calcMontoUSD();
    if (monto_usd <= 0) return;
    setSaving(true);
    await onSave({ fecha, ticker: isAssetOp || tipo === 'dividendo' ? ticker.toUpperCase().trim() : 'EFECTIVO', nombre: isAssetOp ? ticker.toUpperCase().trim() : tipo === 'dividendo' ? ticker.toUpperCase().trim() : (tipo === 'deposito' ? 'Depósito' : 'Retiro'), tipo, cantidad: isAssetOp ? parseFloat(cantidad) || null : null, precio_unitario: isAssetOp ? parseFloat(precioUnitario) || null : null, monto_usd, moneda, tipo_activo: isAssetOp ? tipoActivo : 'efectivo', broker: broker || null, notas: notas || null });
    setSaving(false);
  };
  const ls = { display: 'block' as const, marginBottom: '6px' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '520px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>Agregar operación</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={20} /></button>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <div className="label-xs" style={ls}>Tipo de operación</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[{ key: 'compra', label: '🛒 Compra' },{ key: 'venta', label: '💸 Venta' },{ key: 'dividendo', label: '🎁 Dividendo' },{ key: 'deposito', label: '💵 Depósito' },{ key: 'retiro', label: '🏦 Retiro' }].map(t => (
              <button key={t.key} onClick={() => setTipo(t.key as any)} style={{ background: tipo === t.key ? 'var(--violet)' : 'var(--surface2)', color: tipo === t.key ? '#fff' : 'var(--text2)', border: `1px solid ${tipo === t.key ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ gridColumn: '1 / -1' }}><div className="label-xs" style={ls}>Fecha</div><input className="input-field" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          {(isAssetOp || tipo === 'dividendo') && (<div style={{ gridColumn: '1 / -1' }}><div className="label-xs" style={ls}>Ticker</div><input className="input-field" placeholder="AAPL, GD35, GGAL, NVDAD..." value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} /></div>)}
          {isAssetOp && (<>
            <div><div className="label-xs" style={ls}>Cantidad</div><input className="input-field" type="number" placeholder="0" value={cantidad} onChange={e => setCantidad(e.target.value)} min="0" step="any" /></div>
            <div><div className="label-xs" style={ls}>Precio unitario</div><input className="input-field" type="number" placeholder="0.00" value={precioUnitario} onChange={e => setPrecioUnitario(e.target.value)} min="0" step="any" /></div>
            <div style={{ gridColumn: '1 / -1' }}><div className="label-xs" style={ls}>Tipo de activo</div>
              <select className="input-field" value={tipoActivo} onChange={e => setTipoActivo(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="cedear">CEDEAR</option><option value="accion_ar">Acción Argentina</option><option value="bono">Bono Soberano</option><option value="on">Obligación Negociable</option><option value="etf">ETF</option><option value="crypto">Crypto</option><option value="otro">Otro</option>
              </select>
            </div>
          </>)}
          {isCashOp && (<div style={{ gridColumn: '1 / -1' }}><div className="label-xs" style={ls}>Monto</div><input className="input-field" type="number" placeholder="0.00" value={montoDirecto} onChange={e => setMontoDirecto(e.target.value)} min="0" step="any" /></div>)}
          <div><div className="label-xs" style={ls}>Moneda</div><div style={{ display: 'flex', gap: '6px' }}>{['USD','ARS'].map(m => (<button key={m} onClick={() => setMoneda(m as any)} style={{ flex: 1, background: moneda === m ? 'var(--violet)' : 'var(--surface2)', color: moneda === m ? '#fff' : 'var(--text2)', border: `1px solid ${moneda === m ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>{m}</button>))}</div></div>
          <div><div className="label-xs" style={ls}>Broker</div><input className="input-field" placeholder="IOL, Balanz, Cocos..." value={broker} onChange={e => setBroker(e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><div className="label-xs" style={ls}>Notas (opcional)</div><input className="input-field" placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} /></div>
        </div>
        {montoUSDPreview > 0 && (<div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '13px', color: 'var(--text2)' }}>Equivalente en USD</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', fontWeight: 600, color: 'var(--violet-light)' }}>{fmtUSD(montoUSDPreview)}</span></div>)}
        {moneda === 'ARS' && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Conversión usando MEP actual: ${mep.toLocaleString('es-AR')}</div>}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !canSave} className="btn-primary" style={{ flex: 2, padding: '10px', fontSize: '14px' }}>{saving ? 'Guardando...' : 'Guardar operación'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Importar desde broker ─────────────────────────────────────────────

type BrokerType = 'IOL' | 'Balanz';

function ModalImportarBroker({ operacionesExistentes, mep, onClose, onImport }: { operacionesExistentes: Operacion[]; mep: number; onClose: () => void; onImport: (ops: Omit<Operacion, 'id'>[]) => Promise<void> }) {
  const [broker, setBroker] = useState<BrokerType>('IOL');
  const [ops, setOps] = useState<OpImportada[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(''); setOps([]);
    try {
      let parsed: Omit<OpImportada, 'isDuplicate' | 'selected'>[] = [];
      if (broker === 'IOL') { const text = await file.text(); parsed = parseIOL(text, mep); }
      else { const buffer = await file.arrayBuffer(); parsed = parseBalanz(buffer, mep); }
      if (!parsed.length) { setError('No se encontraron operaciones de compra, venta o dividendo en el archivo.'); setLoading(false); return; }
      setOps(parsed.map(op => ({ ...op, isDuplicate: isDuplicateOp(op, operacionesExistentes), selected: !isDuplicateOp(op, operacionesExistentes) })));
    } catch (e: any) { setError(e?.message || `Error al leer el archivo. Verificá que sea el formato correcto de ${broker}.`); }
    setLoading(false);
  }, [broker, mep, operacionesExistentes]);

  const toggleAll = (val: boolean) => setOps(prev => prev.map(o => ({ ...o, selected: o.isDuplicate ? false : val })));
  const toggleOne = (id: string) => setOps(prev => prev.map(o => o.importId === id && !o.isDuplicate ? { ...o, selected: !o.selected } : o));
  const selectedOps = ops.filter(o => o.selected);
  const dupCount = ops.filter(o => o.isDuplicate).length;
  const newCount = ops.filter(o => !o.isDuplicate).length;

  const handleSave = async () => {
    if (!selectedOps.length) return;
    setSaving(true);
    try { await onImport(selectedOps.map(({ importId, isDuplicate, selected, ...op }) => op)); setSaved(true); }
    catch { setError('Error al guardar las operaciones.'); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '820px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div><div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>Importar desde broker</div><div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Compras, ventas y dividendos. Las cauciones se ignoran automáticamente.</div></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={20} /></button>
        </div>
        {saved ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <CheckCircle2 size={48} color="var(--green)" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>¡Importación exitosa!</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{selectedOps.length} operaciones importadas desde {broker}.</div>
            <button onClick={onClose} className="btn-primary" style={{ marginTop: '24px', padding: '10px 32px' }}>Cerrar</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <div className="label-xs" style={{ marginBottom: '8px' }}>Broker</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['IOL', 'Balanz'] as BrokerType[]).map(b => (<button key={b} onClick={() => { setBroker(b); setOps([]); setError(''); }} style={{ flex: 1, background: broker === b ? 'var(--violet)' : 'var(--surface2)', color: broker === b ? '#fff' : 'var(--text2)', border: `1px solid ${broker === b ? 'var(--violet)' : 'var(--border)'}`, borderRadius: '8px', padding: '10px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', transition: 'all 0.15s' }}>{b}</button>))}
                </div>
              </div>
              <div>
                <div className="label-xs" style={{ marginBottom: '8px' }}>Archivo {broker === 'IOL' ? '(.xls exportado de IOL)' : '(.xlsx exportado de Balanz)'}</div>
                <button onClick={() => fileRef.current?.click()} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: '8px', padding: '10px', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--violet)'; e.currentTarget.style.color = 'var(--violet-light)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}>
                  <Upload size={15} /> Seleccionar archivo
                </button>
                <input ref={fileRef} type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
              </div>
            </div>
            {!ops.length && !loading && !error && (
              <div style={{ padding: '20px', background: 'var(--surface2)', borderRadius: '10px', marginBottom: '16px' }}>
                <div className="label-xs" style={{ marginBottom: '10px' }}>¿Cómo exportar?</div>
                {broker === 'IOL' ? <div style={{ fontSize: '12px', color: 'var(--muted2)', lineHeight: 1.7 }}>En IOL: <strong style={{ color: 'var(--text)' }}>Mis inversiones → Movimientos → Exportar XLS</strong>.</div> : <div style={{ fontSize: '12px', color: 'var(--muted2)', lineHeight: 1.7 }}>En Balanz: <strong style={{ color: 'var(--text)' }}>Mi cuenta → Movimientos → Descargar Excel</strong>.</div>}
              </div>
            )}
            {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Procesando archivo...</div>}
            {error && (<div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '16px' }}><AlertCircle size={16} color="var(--red)" style={{ flexShrink: 0, marginTop: '1px' }} /><div style={{ fontSize: '13px', color: 'var(--red)', fontFamily: 'DM Mono, monospace' }}>{error}</div></div>)}
            {ops.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <div style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle2 size={14} color="var(--green)" /><span style={{ fontSize: '13px', color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{newCount} nuevas</span></div>
                  {dupCount > 0 && (<div style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertCircle size={14} color="var(--amber)" /><span style={{ fontSize: '13px', color: 'var(--amber)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{dupCount} posibles duplicados</span></div>)}
                  <div style={{ padding: '8px 14px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px' }}><span style={{ fontSize: '13px', color: 'var(--violet-light)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{selectedOps.length} seleccionadas</span></div>
                </div>
                <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: '16px' }}>
                  <div style={{ padding: '10px 16px', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={selectedOps.length === newCount && newCount > 0} onChange={e => toggleAll(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--violet)' }} />
                    <span style={{ fontSize: '12px', color: 'var(--muted2)' }}>Seleccionar todas las nuevas</span>
                  </div>
                  <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['','Fecha','Tipo','Ticker','Cantidad','Precio','Monto USD','Moneda','Estado'].map(h => (<th key={h} style={{ padding: '8px 12px', color: 'var(--muted2)', fontWeight: 400, textAlign: h === '' ? 'center' : 'left', whiteSpace: 'nowrap' }}>{h}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {ops.map(op => (
                          <tr key={op.importId} onClick={() => toggleOne(op.importId)} style={{ borderBottom: '1px solid var(--border)', background: op.isDuplicate ? 'rgba(245,158,11,0.03)' : op.selected ? 'rgba(124,58,237,0.04)' : 'transparent', cursor: op.isDuplicate ? 'default' : 'pointer', opacity: op.isDuplicate ? 0.6 : 1 }}>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}><input type="checkbox" checked={op.selected} disabled={op.isDuplicate} onChange={() => toggleOne(op.importId)} style={{ width: '14px', height: '14px', cursor: op.isDuplicate ? 'default' : 'pointer', accentColor: 'var(--violet)' }} onClick={e => e.stopPropagation()} /></td>
                            <td style={{ padding: '8px 12px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{new Date(op.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                            <td style={{ padding: '8px 12px' }}><span style={{ color: TIPO_COLORS_OP[op.tipo] || 'var(--text)', fontWeight: 600, textTransform: 'capitalize' }}>{op.tipo}</span></td>
                            <td style={{ padding: '8px 12px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text)' }}>{op.ticker}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--text2)' }}>{op.cantidad != null ? fmtNum(op.cantidad, 2) : '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--text2)' }}>{op.precio_unitario != null ? (op.moneda === 'ARS' ? fmtARS(op.precio_unitario) : fmtUSD(op.precio_unitario)) : '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--text)', fontWeight: 600 }}>{fmtUSD(op.monto_usd)}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--muted2)' }}>{op.moneda}</td>
                            <td style={{ padding: '8px 12px' }}>{op.isDuplicate ? <span style={{ fontSize: '10px', color: 'var(--amber)', background: 'rgba(245,158,11,0.12)', borderRadius: '4px', padding: '2px 6px' }}>duplicado</span> : <span style={{ fontSize: '10px', color: 'var(--green)', background: 'rgba(34,197,94,0.12)', borderRadius: '4px', padding: '2px 6px' }}>nueva</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginBottom: '16px' }}>* Las operaciones en ARS se convirtieron a USD usando el MEP actual (${mep.toLocaleString('es-AR')}).</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={onClose} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px' }}>Cancelar</button>
                  <button onClick={handleSave} disabled={saving || !selectedOps.length} className="btn-primary" style={{ flex: 2, padding: '10px', fontSize: '14px' }}>{saving ? 'Importando...' : `Importar ${selectedOps.length} operación${selectedOps.length !== 1 ? 'es' : ''}`}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
      <div style={{ fontSize: '40px', marginBottom: '16px' }}>💼</div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>Tu portfolio está vacío</div>
      <div style={{ fontSize: '13px', color: 'var(--muted2)', maxWidth: '400px', margin: '0 auto 24px' }}>Agregá operaciones manualmente o importá directamente desde IOL o Balanz.</div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onAdd} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}><Plus size={16} /> Agregar operación</button>
        <button onClick={onImport} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '10px 24px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px' }}><Upload size={16} /> Importar desde broker</button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type Tab = 'posiciones' | 'mapa' | 'distribucion' | 'performance' | 'historial' | 'operaciones';

export default function PortfolioPage() {
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [posiciones, setPosiciones] = useState<PosicionCompleta[]>([]);
  const [realizadas, setRealizadas] = useState<GananciaRealizada[]>([]);
  const [vencimientosMap, setVencimientosMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mep, setMep] = useState(1430);
  const [tab, setTab] = useState<Tab>('posiciones');
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
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

    const vMap: Record<string, string> = {};
    const hoy = new Date();

    const results = await Promise.all(posArray.map(async (pos, idx) => {
      const { precioUSD, precioOriginal, moneda, variacion, vencimiento } = await fetchPrecio(pos.ticker, mepRate);
      if (vencimiento) vMap[normalizarTicker(pos.ticker)] = vencimiento;
      const esVencido = vencimiento ? new Date(vencimiento) < hoy : false;
      const valorActualUSD = !esVencido && precioUSD != null ? precioUSD * pos.cantidad : null;
      const pnlUSD = valorActualUSD != null ? valorActualUSD - pos.costoTotalUSD : null;
      const pnlPct = pnlUSD != null && pos.costoTotalUSD > 0 ? (pnlUSD / pos.costoTotalUSD) * 100 : null;
      return { idx, precioActual: precioOriginal, moneda: moneda as 'ARS' | 'USD', valorActualUSD, pnlUSD, pnlPct, variacion, esVencido };
    }));

    setVencimientosMap(vMap);

    const completed = posArray.map((pos, idx) => {
      const r = results.find(x => x.idx === idx);
      if (!r) return { ...pos, loadingPrecio: false };
      return { ...pos, ...r, loadingPrecio: false };
    });

    const activas = completed.filter(p => !p.esVencido);
    setPosiciones(activas);
    const totalActivos = activas.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
    setXirr(calcularCAGR(ops, totalActivos));
    setRealizadas(calcularGananciasRealizadas(ops, vMap));
  }, []);

  const loadData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    const ops = await loadOperaciones();
    setOperaciones(ops);
    if (ops.length > 0) await buildPositions(ops, mep);
    if (refresh) setRefreshing(false); else setLoading(false);
  }, [mep, loadOperaciones, buildPositions]);

  useEffect(() => { loadData(); }, [mep]);

  const handleImport = async (ops: Omit<Operacion, 'id'>[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sesión expirada');
    const { error } = await supabase.from('operaciones').insert(ops.map(op => ({ ...op, user_id: user.id })));
    if (error) throw new Error(error.message);
    setShowImport(false);
    await loadData(true);
  };

  const totalActivosUSD = posiciones.reduce((s, p) => s + (p.valorActualUSD || 0), 0);
  const valorTotalUSD = totalActivosUSD + efectivoUSD;
  const gananciaNeta = valorTotalUSD - totalInvertidoUSD;
  const gananciaNetaPct = totalInvertidoUSD > 0 ? (gananciaNeta / totalInvertidoUSD) * 100 : 0;
  const variacionHoy = posiciones.reduce((s, p) => { if (p.variacionDiaria != null && p.valorActualUSD != null) return s + p.valorActualUSD - (p.valorActualUSD / (1 + p.variacionDiaria / 100)); return s; }, 0);
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
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setShowImport(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}><Upload size={14} /> Importar</button>
          <button onClick={() => loadData(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}><RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Actualizar</button>
          <button onClick={() => setShowModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={16} /> Agregar operación</button>
        </div>
      </div>

      {operaciones.length === 0 ? (
        <EmptyState onAdd={() => setShowModal(true)} onImport={() => setShowImport(true)} />
      ) : (
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
              {mejorActivo && (<div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(34,197,94,0.2)' }}><TrendingUp size={20} color="var(--green)" /><div><div className="label-xs" style={{ marginBottom: '2px' }}>MEJOR ACTIVO</div><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--green)', marginRight: '8px' }}>{mejorActivo.ticker}</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: 'var(--green)' }}>{fmtPct(mejorActivo.pnlPct)}</span></div></div>)}
              {peorActivo && peorActivo.ticker !== mejorActivo?.ticker && (<div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'rgba(244,63,94,0.2)' }}><TrendingDown size={20} color="var(--red)" /><div><div className="label-xs" style={{ marginBottom: '2px' }}>PEOR ACTIVO</div><span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: 'var(--red)', marginRight: '8px' }}>{peorActivo.ticker}</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: colorV(peorActivo.pnlPct) }}>{fmtPct(peorActivo.pnlPct)}</span></div></div>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px', overflowX: 'auto' }}>
            {[{ key: 'posiciones' as Tab, label: 'Posiciones', icon: '📋' },{ key: 'mapa' as Tab, label: 'Mapa', icon: '🗺️' },{ key: 'distribucion' as Tab, label: 'Distribución', icon: '🥧' },{ key: 'performance' as Tab, label: 'Performance', icon: '🏆' },{ key: 'historial' as Tab, label: 'Historial', icon: '📈' },{ key: 'operaciones' as Tab, label: 'Operaciones', icon: '📝' }].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tab === t.key ? 'var(--violet)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted2)', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {tab === 'posiciones'   && <TabPosiciones posiciones={posiciones} efectivoUSD={efectivoUSD} />}
          {tab === 'mapa'         && <TabMapa posiciones={posiciones} />}
          {tab === 'distribucion' && <TabDistribucion posiciones={posiciones} efectivoUSD={efectivoUSD} />}
          {tab === 'performance'  && <TabPerformance posiciones={posiciones} realizadas={realizadas} />}
          {tab === 'historial'    && <TabHistorial operaciones={operaciones} mep={mep} valorActualIol={valorTotalUSD} />}
          {tab === 'operaciones'  && <TabOperaciones operaciones={operaciones} onDelete={async (id) => { await supabase.from('operaciones').delete().eq('id', id); await loadData(true); }} onImport={() => setShowImport(true)} />}
        </>
      )}

      {showModal && (
        <ModalAgregarOp mep={mep} onClose={() => setShowModal(false)} onSave={async (op) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) { alert('Sesión expirada.'); return; }
          const { error } = await supabase.from('operaciones').insert({ ...op, user_id: user.id });
          if (error) { alert('Error: ' + error.message); return; }
          setShowModal(false); await loadData(true);
        }} />
      )}

      {showImport && (
        <ModalImportarBroker operacionesExistentes={operaciones} mep={mep} onClose={() => setShowImport(false)} onImport={handleImport} />
      )}
    </div>
  );
}

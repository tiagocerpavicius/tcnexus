import type { Moneda, Ley, TipoBono, FlujoPago } from './types';

export interface BondSpec {
  tickers: string[];
  nombre: string;
  emisor: string;
  tipo: TipoBono;
  moneda: Moneda;
  ley: Ley;
  sector?: string;
  tasaCupon: number;
  frecuencia: 1 | 2 | 4 | 12;
  vencimiento: string;
  vnResidual: number;
  amortizaciones: { fecha: string; pct: number }[];
  esAprox?: boolean;
}

function isoDate(d: Date): string { return d.toISOString().split('T')[0]; }
function addMonths(d: Date, m: number): Date { const r = new Date(d); r.setMonth(r.getMonth() + m); return r; }

export function generarFlujos(spec: BondSpec, desde?: Date): FlujoPago[] {
  const hoy = desde || new Date();
  const vto = new Date(spec.vencimiento);
  const step = 12 / spec.frecuencia;
  const fechas: Date[] = [];
  let cur = new Date(vto);
  while (cur > hoy) { fechas.unshift(new Date(cur)); cur = addMonths(cur, -step); }

  const amortMap: Record<string, number> = {};
  for (const a of spec.amortizaciones) {
    if (new Date(a.fecha) > hoy) amortMap[a.fecha] = (a.pct * spec.vnResidual) / 100;
  }

  let vn = spec.vnResidual;
  const flujos: FlujoPago[] = [];

  for (const fecha of fechas) {
    const fs = isoDate(fecha);
    const interes = +((vn * spec.tasaCupon) / 100 / spec.frecuencia).toFixed(4);
    const amort = spec.amortizaciones.length === 0 && fs === spec.vencimiento
      ? vn
      : +(amortMap[fs] || 0).toFixed(4);
    flujos.push({ fecha: fs, interes, amortizacion: amort, total: +(interes + amort).toFixed(4), vnVigente: +vn.toFixed(4) });
    vn = Math.max(0, vn - amort);
  }
  if (flujos.length > 0) {
    const ult = flujos[flujos.length - 1];
    if (ult.amortizacion === 0 && vn > 0) { ult.amortizacion = +vn.toFixed(4); ult.total = +(ult.interes + ult.amortizacion).toFixed(4); }
  }
  return flujos;
}

export function calcularTIR(precioUSD: number, flujos: FlujoPago[]): number {
  const hoy = new Date();
  const cf = flujos.map(f => ({ t: (new Date(f.fecha).getTime() - hoy.getTime()) / (365.25 * 86400000), v: f.total })).filter(f => f.t > 0 && f.v > 0);
  if (!cf.length) return 0;
  let tir = 0.08;
  for (let i = 0; i < 300; i++) {
    let npv = -precioUSD, dnpv = 0;
    for (const { t, v } of cf) { const d = Math.pow(1 + tir, t); npv += v / d; dnpv -= (t * v) / (d * (1 + tir)); }
    if (Math.abs(npv) < 0.000001 || Math.abs(dnpv) < 1e-10) break;
    tir -= npv / dnpv;
    if (tir < -0.99) tir = -0.99; if (tir > 50) tir = 50;
  }
  return +((tir * 100).toFixed(4));
}

export function calcularDuration(flujos: FlujoPago[], tirPct: number): number {
  const hoy = new Date(); const tir = tirPct / 100;
  let sumPV = 0, sumPVt = 0;
  for (const f of flujos) {
    const t = (new Date(f.fecha).getTime() - hoy.getTime()) / (365.25 * 86400000);
    if (t <= 0 || f.total <= 0) continue;
    const pv = f.total / Math.pow(1 + tir, t);
    sumPV += pv; sumPVt += t * pv;
  }
  return sumPV > 0 ? +((sumPVt / sumPV).toFixed(4)) : 0;
}

export function calcularInteresCorreido(spec: BondSpec): number {
  const hoy = new Date(); const vto = new Date(spec.vencimiento);
  const step = 12 / spec.frecuencia;
  let ult = new Date(vto);
  while (ult > hoy) ult = addMonths(ult, -step);
  const sig = addMonths(ult, step);
  const diasTotal = (sig.getTime() - ult.getTime()) / 86400000;
  const diasTrans = (hoy.getTime() - ult.getTime()) / 86400000;
  return +((spec.vnResidual * spec.tasaCupon / 100 / spec.frecuencia) * (diasTrans / diasTotal)).toFixed(4);
}

export function getAnalytics(spec: BondSpec, precioUSD: number) {
  const flujos = generarFlujos(spec);
  const tir = calcularTIR(precioUSD, flujos);
  const duration = calcularDuration(flujos, tir);
  const durationMod = +((duration / (1 + tir / 100 / spec.frecuencia)).toFixed(4));
  const pvbp = +((precioUSD * durationMod / 10000).toFixed(6));
  const interesCorreido = calcularInteresCorreido(spec);
  return {
    tir, duration, durationMod, pvbp,
    paridad: +((precioUSD / spec.vnResidual * 100).toFixed(2)),
    interesCorreido,
    precioDirty: +(precioUSD + interesCorreido).toFixed(4),
    precioClean: precioUSD,
    flujos,
    cantFlujos: flujos.length,
    proximoPago: flujos[0] || null,
  };
}

export const BONOS_DB: BondSpec[] = [
  // ── SOBERANOS ────────────────────────────────────────────
  { tickers: ['GD29','AL29'], nombre: 'Bono Rep. Argentina USD 4.125% 2029', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 4.125, frecuencia: 2, vencimiento: '2029-07-09', vnResidual: 100, amortizaciones: [] },
  { tickers: ['GD30','AL30'], nombre: 'Bono Rep. Argentina USD Step Up 2030', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 5.0, frecuencia: 2, vencimiento: '2030-01-09', vnResidual: 100, amortizaciones: [{ fecha: '2027-07-09', pct: 4 },{ fecha: '2028-01-09', pct: 8 },{ fecha: '2028-07-09', pct: 8 },{ fecha: '2029-01-09', pct: 8 },{ fecha: '2029-07-09', pct: 8 },{ fecha: '2030-01-09', pct: 64 }], esAprox: true },
  { tickers: ['GD35','AL35'], nombre: 'Bono Rep. Argentina USD Step Up 2035', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 5.625, frecuencia: 2, vencimiento: '2035-07-09', vnResidual: 100, amortizaciones: [{ fecha: '2032-01-09', pct: 16.667 },{ fecha: '2032-07-09', pct: 16.667 },{ fecha: '2033-01-09', pct: 16.667 },{ fecha: '2033-07-09', pct: 16.667 },{ fecha: '2034-01-09', pct: 16.667 },{ fecha: '2035-07-09', pct: 16.665 }], esAprox: true },
  { tickers: ['AE38','GD38'], nombre: 'Bono Rep. Argentina USD 5% 2038', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 5.0, frecuencia: 2, vencimiento: '2038-01-09', vnResidual: 100, amortizaciones: [] },
  { tickers: ['GD41','AL41'], nombre: 'Bono Rep. Argentina USD Step Up 2041', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 5.625, frecuencia: 2, vencimiento: '2041-07-09', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['GD46'], nombre: 'Bono Rep. Argentina USD 5.25% 2046', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'nueva_york', tasaCupon: 5.25, frecuencia: 2, vencimiento: '2046-07-09', vnResidual: 100, amortizaciones: [] },
  { tickers: ['AO28'], nombre: 'Bonar 2028 USD 6%', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'argentina', tasaCupon: 6.0, frecuencia: 12, vencimiento: '2028-10-31', vnResidual: 100, amortizaciones: [] },
  { tickers: ['AO27'], nombre: 'Bono del Tesoro USD 2027', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'argentina', tasaCupon: 8.0, frecuencia: 2, vencimiento: '2027-07-09', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['AN29'], nombre: 'Bono del Tesoro USD 2029', emisor: 'República Argentina', tipo: 'soberano', moneda: 'USD', ley: 'argentina', tasaCupon: 7.5, frecuencia: 2, vencimiento: '2029-07-09', vnResidual: 100, amortizaciones: [], esAprox: true },
  // ── PROVINCIALES ─────────────────────────────────────────
  { tickers: ['CO35'], nombre: 'Provincia de Córdoba USD 2035', emisor: 'Provincia de Córdoba', tipo: 'provincial', moneda: 'USD', ley: 'nueva_york', tasaCupon: 7.125, frecuencia: 2, vencimiento: '2035-06-10', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['CO32'], nombre: 'Provincia de Córdoba USD 2032', emisor: 'Provincia de Córdoba', tipo: 'provincial', moneda: 'USD', ley: 'nueva_york', tasaCupon: 7.125, frecuencia: 2, vencimiento: '2032-06-10', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['SFD34'], nombre: 'Provincia de Santa Fe USD 2034', emisor: 'Provincia de Santa Fe', tipo: 'provincial', moneda: 'USD', ley: 'nueva_york', tasaCupon: 7.0, frecuencia: 2, vencimiento: '2034-03-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['PMO28'], nombre: 'Provincia de Mendoza USD 2028', emisor: 'Provincia de Mendoza', tipo: 'provincial', moneda: 'USD', ley: 'nueva_york', tasaCupon: 8.375, frecuencia: 2, vencimiento: '2028-05-19', vnResidual: 100, amortizaciones: [], esAprox: true },
  // ── ONs ──────────────────────────────────────────────────
  { tickers: ['YCA6O'], nombre: 'YPF SA ON USD 6.95% 2027', emisor: 'YPF SA', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 6.95, frecuencia: 2, vencimiento: '2027-07-21', vnResidual: 100, amortizaciones: [] },
  { tickers: ['YFCAO'], nombre: 'YPF SA ON USD 9.5% 2029', emisor: 'YPF SA', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 9.5, frecuencia: 2, vencimiento: '2029-03-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['YMC3O'], nombre: 'YPF SA ON USD 8.75% 2028', emisor: 'YPF SA', tipo: 'ON', moneda: 'USD', ley: 'argentina', sector: 'Energía', tasaCupon: 8.75, frecuencia: 2, vencimiento: '2028-04-04', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['VSCAO'], nombre: 'Vista Energy ON USD 7.875% 2027', emisor: 'Vista Energy', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 7.875, frecuencia: 2, vencimiento: '2027-03-15', vnResidual: 100, amortizaciones: [] },
  { tickers: ['VSC2O'], nombre: 'Vista Energy ON USD 8.625% 2030', emisor: 'Vista Energy', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 8.625, frecuencia: 2, vencimiento: '2030-06-01', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['MGC1O'], nombre: 'Pampa Energía ON USD 7.375% 2029', emisor: 'Pampa Energía', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 7.375, frecuencia: 2, vencimiento: '2029-07-21', vnResidual: 100, amortizaciones: [] },
  { tickers: ['PAMXO'], nombre: 'Pampa Energía ON USD 9.125% 2027', emisor: 'Pampa Energía', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 9.125, frecuencia: 2, vencimiento: '2027-04-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['TGS2D'], nombre: 'TGS ON USD 8.125% 2031', emisor: 'Transportadora Gas del Sur', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 8.125, frecuencia: 2, vencimiento: '2031-06-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['PPC2O'], nombre: 'Pluspetrol ON USD 8.5% 2031', emisor: 'Pluspetrol', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 8.5, frecuencia: 2, vencimiento: '2031-09-01', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['PAEPO'], nombre: 'Pan American Energy ON USD 2027', emisor: 'Pan American Energy', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Energía', tasaCupon: 7.875, frecuencia: 2, vencimiento: '2027-05-10', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['GNCXO'], nombre: 'Banco Galicia ON USD 8.25% 2026', emisor: 'Banco Galicia', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Financiero', tasaCupon: 8.25, frecuencia: 2, vencimiento: '2026-07-28', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['GNC5O'], nombre: 'Banco Galicia ON USD 7.75% 2028', emisor: 'Banco Galicia', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Financiero', tasaCupon: 7.75, frecuencia: 2, vencimiento: '2028-11-08', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['BMACD'], nombre: 'Banco Macro ON USD 6.75% 2026', emisor: 'Banco Macro', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Financiero', tasaCupon: 6.75, frecuencia: 2, vencimiento: '2026-07-29', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['BMC4O'], nombre: 'Banco Macro ON USD 8.875% 2030', emisor: 'Banco Macro', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Financiero', tasaCupon: 8.875, frecuencia: 2, vencimiento: '2030-01-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['SUPVD'], nombre: 'Banco Supervielle ON USD 9% 2027', emisor: 'Banco Supervielle', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Financiero', tasaCupon: 9.0, frecuencia: 2, vencimiento: '2027-08-12', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['IRCFO'], nombre: 'IRSA ON USD 8.75% 2028', emisor: 'IRSA Inversiones', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Real Estate', tasaCupon: 8.75, frecuencia: 2, vencimiento: '2028-03-22', vnResidual: 100, amortizaciones: [] },
  { tickers: ['IRC2O'], nombre: 'IRSA ON USD 8.5% 2032', emisor: 'IRSA Inversiones', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Real Estate', tasaCupon: 8.5, frecuencia: 2, vencimiento: '2032-06-28', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['AA2OD'], nombre: 'Aeropuertos Argentina 2000 ON USD 2031', emisor: 'Aeropuertos Argentina 2000', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Infraestructura', tasaCupon: 8.5, frecuencia: 2, vencimiento: '2031-09-01', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['TLCMO'], nombre: 'Telecom Argentina ON USD 8% 2026', emisor: 'Telecom Argentina', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Telecomunicaciones', tasaCupon: 8.0, frecuencia: 2, vencimiento: '2026-11-22', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['TLC5O'], nombre: 'Telecom Argentina ON USD 8.5% 2031', emisor: 'Telecom Argentina', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Telecomunicaciones', tasaCupon: 8.5, frecuencia: 2, vencimiento: '2031-03-29', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['CVCHO'], nombre: 'Cablevision ON USD 6.5% 2027', emisor: 'Cablevision', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Telecomunicaciones', tasaCupon: 6.5, frecuencia: 2, vencimiento: '2027-01-15', vnResidual: 100, amortizaciones: [], esAprox: true },
  { tickers: ['RCCJO'], nombre: 'Arcor ON USD 6% 2027', emisor: 'Arcor', tipo: 'ON', moneda: 'USD', ley: 'nueva_york', sector: 'Consumo', tasaCupon: 6.0, frecuencia: 2, vencimiento: '2027-03-15', vnResidual: 100, amortizaciones: [], esAprox: true },
];

export function buscarBono(ticker: string): BondSpec | null {
  const t = ticker.toUpperCase().replace(/D$/, '');
  return BONOS_DB.find(b => b.tickers.some(bt => bt.toUpperCase() === t || bt.toUpperCase() === ticker.toUpperCase())) || null;
}

'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Download, RefreshCw, Sparkles, Calendar, AlertTriangle, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useIsMobile } from '@/hooks/useIsMobile';

const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontFamily: 'DM Mono, monospace',
  fontSize: '12px',
  color: 'var(--text)',
};
const TOOLTIP_ITEM_STYLE = { color: 'var(--text)' };
const TOOLTIP_LABEL_STYLE = { color: 'var(--muted2)' };

type Periodo = 'diario' | 'semanal' | 'mensual' | 'anual' | 'historico' | 'custom';

const PERIODOS: { key: Periodo; label: string; icon: string }[] = [
  { key: 'diario',    label: 'Diario',        icon: '📅' },
  { key: 'semanal',   label: 'Semanal',       icon: '📆' },
  { key: 'mensual',   label: 'Mensual',       icon: '🗓️' },
  { key: 'anual',     label: 'Anual',         icon: '📊' },
  { key: 'historico', label: 'Histórico',     icon: '📈' },
  { key: 'custom',    label: 'Personalizado', icon: '🎯' },
];

const fmtUSD = (n: number | null | undefined) =>
  n == null ? '—' : 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const colorV = (n: number | null | undefined) =>
  n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const SECTOR_COLORS: Record<string, string> = {
  'Tecnología':     '#7c3aed',
  'Financiero':     '#06b6d4',
  'Energía':        '#f59e0b',
  'Consumo':        '#10b981',
  'Salud':          '#ec4899',
  'Industriales':   '#8b5cf6',
  'Materiales':     '#f97316',
  'Comunicaciones': '#14b8a6',
  'Real Estate':    '#a3e635',
  'Renta Fija':     '#94a3b8',
  'Cripto':         '#f43f5e',
  'ETF Diversif.':  '#38bdf8',
  'Otros':          '#475569',
};

const RANGE_MAP: Record<string, string> = {
  diario:    '5d',
  semanal:   '1mo',
  mensual:   '3mo',
  anual:     '1y',
  historico: '5y',
  custom:    '5y',
};

interface PosicionActivo {
  ticker: string;
  tickerBuscar: string;
  cantidad: number;
  costoTotal: number;
  costoPromedio: number;
  dividendos: number;
  tipo: string;
  broker: string;
}

interface ReporteData {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  mep: number;
  capitalInicial: number;
  depositosPeriodo: number;
  retirosPeriodo: number;
  dividendosPeriodo: number;
  capitalCaucionado: number;
  interesesCauciones: number;
  tnaPromedio: number | null;
  tickersAbiertos: string[];
  performancePorActivo: PosicionActivo[];
  historialCapital: { fecha: string; valor: number }[];
  volatilidad: number | null;
  maxDrawdown: number;
  totalOps: number;
  opsPeriodoCount: number;
  efectivoUSD: number;
}

interface PrecioInfo {
  precio: number | null;
  moneda: string;
}

interface HistoricoInfo {
  precioInicio: number | null;
  precioActual: number | null;
  retornoPeriodo: number | null;
}

interface IAData {
  resumen_ejecutivo: string;
  analisis_rendimiento: string;
  analisis_riesgo: string;
  cauciones: string | null;
  recomendaciones: string[];
  alertas: string[];
  sesgo: string;
  confianza: string;
}

export default function ReportesPage() {
  const isMobile = useIsMobile();
  const [periodo, setPeriodo] = useState<Periodo>('mensual');
  const [customInicio, setCustomInicio] = useState('');
  const [customFin, setCustomFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [reporte, setReporte] = useState<ReporteData | null>(null);
  const [sectores, setSectores] = useState<Record<string, { sector: string; industria: string; pais: string }>>({});
  const [precios, setPrecios] = useState<Record<string, PrecioInfo>>({});
  const [historicos, setHistoricos] = useState<Record<string, HistoricoInfo>>({});
  const [iaData, setIAData] = useState<IAData | null>(null);
  const [iaLoading, setIALoading] = useState(false);
  const [iaError, setIAError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setUserId(data.user.id);
    });
  }, []);

  useEffect(() => {
    if (userId && periodo !== 'custom') cargarReporte();
  }, [userId, periodo]);

  async function cargarReporte() {
    if (!userId) return;
    if (periodo === 'custom' && (!customInicio || !customFin)) return;
    setLoading(true);
    setError(null);
    setReporte(null);
    setIAData(null);
    setSectores({});
    setPrecios({});
    setHistoricos({});
    try {
      const res = await fetch('/api/reportes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          periodo,
          fechaCustomInicio: customInicio || undefined,
          fechaCustomFin: customFin || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReporte(data);

      const tickersBase = data.performancePorActivo.map((p: PosicionActivo) => p.ticker);
      if (tickersBase.length) {
        cargarSectores(tickersBase);
        cargarPrecios(data.performancePorActivo, data.mep);
        cargarHistoricos(data.performancePorActivo, data.fechaInicio, data.mep, periodo);
      }
    } catch (e: any) {
      setError(e.message || 'Error al cargar el reporte');
    }
    setLoading(false);
  }

  async function cargarSectores(tickers: string[]) {
    try {
      const res = await fetch('/api/ticker-sector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json();
      setSectores(data);
    } catch {}
  }

  async function cargarPrecios(posiciones: PosicionActivo[], mepActual: number) {
  const preciosMap: Record<string, PrecioInfo> = {};
  await Promise.all(
    posiciones.map(async pos => {
      try {
        // Intento 1: ticker con D (precio USD directo de IOL)
        const res1 = await fetch(`/api/buscar?ticker=${pos.tickerBuscar}`);
        const data1 = await res1.json();

        if (!data1.error) {
          let precio: number | null = null;
          let moneda = 'USD';
          if (data1.tipo === 'cedear') {
            precio = data1.precio?.valor ?? null;
            moneda = data1.precio?.moneda || 'ARS';
          } else if (data1.tipo === 'renta_variable') {
            precio = data1.precio ?? null;
            moneda = data1.monedaLabel || 'USD';
          } else if (data1.tipo === 'renta_fija') {
            precio = data1.precio?.valor ?? null;
            moneda = data1.monedaLabel || 'USD';
          }
          const precioUSD = precio != null
            ? (moneda === 'ARS' ? precio / mepActual : precio)
            : null;
          preciosMap[pos.ticker] = { precio: precioUSD, moneda: 'USD' };
          return;
        }

        // Intento 2: ticker sin D en ARS → dividir por MEP
        const res2 = await fetch(`/api/buscar?ticker=${pos.ticker}`);
        const data2 = await res2.json();

        if (!data2.error) {
          // Siempre viene en ARS cuando usamos sin D
          const precioARS = data2.precio?.valor ?? data2.precio ?? null;
          const precioUSD = precioARS != null ? precioARS / mepActual : null;
          preciosMap[pos.ticker] = { precio: precioUSD, moneda: 'USD' };
          return;
        }

        preciosMap[pos.ticker] = { precio: null, moneda: 'USD' };
      } catch {
        preciosMap[pos.ticker] = { precio: null, moneda: 'USD' };
      }
    })
  );
  setPrecios(preciosMap);
}

  async function cargarHistoricos(
  posiciones: PosicionActivo[],
  fechaInicio: string,
  mepActual: number,
  periodoActual: string
) {
  const historicosMap: Record<string, HistoricoInfo> = {};
  const range = RANGE_MAP[periodoActual] || '1y';

  // Traer histórico del MEP una sola vez para todos los tickers
  let mepHistorico: { fecha: string; venta: number }[] = [];
  try {
    const mepRes = await fetch('/api/historico-mep');
    const mepData = await mepRes.json();
    if (Array.isArray(mepData)) {
      mepHistorico = mepData.map((d: any) => ({ fecha: d.fecha, venta: d.venta }));
    }
  } catch {}

  // Función para obtener MEP de una fecha específica
  const getMepFecha = (fecha: string): number => {
    const entry = [...mepHistorico]
      .filter(m => m.fecha <= fecha)
      .at(-1);
    return entry?.venta || mepActual;
  };

  await Promise.all(
    posiciones.map(async pos => {
      try {
        if (pos.tipo === 'bono' || pos.tipo === 'efectivo') {
          historicosMap[pos.ticker] = { precioInicio: null, precioActual: null, retornoPeriodo: null };
          return;
        }

        let hist: { fecha: string; cierre: number }[] = [];

        if (pos.tipo === 'cedear') {
          // Intento 1: CEDEAR en ARS con suffix .BA → convertir a USD con MEP histórico
          try {
            // Ticker sin D para ARS en Yahoo .BA
            const tickerARS = pos.ticker; // sin D
            const res = await fetch(
              `/api/historico?ticker=${tickerARS}&suffix=.BA&range=${range}&interval=1d`
            );
            const data = await res.json();
            if (data.historico?.length > 1) {
              // Convertir cada precio ARS a USD usando MEP de esa fecha
              hist = data.historico.map((h: any) => ({
                fecha: h.fecha,
                cierre: mepHistorico.length > 0
                  ? h.cierre / getMepFecha(h.fecha)
                  : h.cierre / mepActual,
              }));
            }
          } catch {}

          // Intento 2: fallback con ticker+D suffix .BA (precio ya en USD)
          if (!hist.length) {
            try {
              const res = await fetch(
                `/api/historico?ticker=${pos.tickerBuscar}&suffix=.BA&range=${range}&interval=1d`
              );
              const data = await res.json();
              if (data.historico?.length > 1) {
                hist = data.historico;
              }
            } catch {}
          }

          // Intento 3: fallback Yahoo US sin suffix
          if (!hist.length) {
            try {
              const res = await fetch(
                `/api/historico?ticker=${pos.ticker}&suffix=&range=${range}&interval=1d`
              );
              const data = await res.json();
              if (data.historico?.length > 1) {
                hist = data.historico;
              }
            } catch {}
          }
        } else if (pos.tipo === 'accion_ar') {
          // Acciones AR: Yahoo con suffix .BA en ARS → convertir a USD
          try {
            const res = await fetch(
              `/api/historico?ticker=${pos.ticker}&suffix=.BA&range=${range}&interval=1d`
            );
            const data = await res.json();
            if (data.historico?.length > 1) {
              hist = data.historico.map((h: any) => ({
                fecha: h.fecha,
                cierre: mepHistorico.length > 0
                  ? h.cierre / getMepFecha(h.fecha)
                  : h.cierre / mepActual,
              }));
            }
          } catch {}
        }

        if (!hist.length) {
          historicosMap[pos.ticker] = { precioInicio: null, precioActual: null, retornoPeriodo: null };
          return;
        }

        // Precio al inicio del período
        const precioInicioEntry = [...hist]
          .filter(h => h.fecha <= fechaInicio)
          .at(-1) || hist[0];
        const precioInicio = precioInicioEntry?.cierre ?? null;

        // Precio actual — último dato
        const precioActualHist = hist.at(-1)?.cierre ?? null;

        const retornoPeriodo = (() => {
  if (!reporte || Object.keys(historicos).length === 0) return null;

  let valorInicio = 0;
  let valorActual = 0;
  let posicionesConDatos = 0;

  reporte.performancePorActivo.forEach(pos => {
    const hist = historicos[pos.ticker];
    const precioActual = precios[pos.ticker]?.precio ?? null;
    if (hist?.precioInicio && precioActual) {
      valorInicio += hist.precioInicio * pos.cantidad;
      valorActual += precioActual * pos.cantidad;
      posicionesConDatos++;
    }
  });

  if (posicionesConDatos === 0 || valorInicio === 0) return null;
  return ((valorActual - valorInicio) / valorInicio) * 100;
})();

        historicosMap[pos.ticker] = {
          precioInicio,
          precioActual: precioActualHist,
          retornoPeriodo,
        };
      } catch {
        historicosMap[pos.ticker] = { precioInicio: null, precioActual: null, retornoPeriodo: null };
      }
    })
  );
  setHistoricos(historicosMap);
}

  async function generarIA() {
    if (!reporte) return;
    setIALoading(true);
    setIAError(null);
    try {
      const efectivo = reporte.efectivoUSD || 0;
      const capitalActivo = reporte.performancePorActivo.reduce((sum, pos) => {
        const precioUSD = precios[pos.ticker]?.precio ?? null;
        return sum + (precioUSD != null ? precioUSD * pos.cantidad : pos.costoTotal);
      }, 0);
      const capitalActual = capitalActivo + reporte.interesesCauciones + efectivo;
      const retornoPeriodo = reporte.capitalInicial > 0
        ? (capitalActual - reporte.capitalInicial) / reporte.capitalInicial * 100
        : null;
      const sharpe = reporte.volatilidad && reporte.volatilidad > 0 && retornoPeriodo != null
        ? +((retornoPeriodo - 4.5) / reporte.volatilidad).toFixed(2)
        : null;

      const expSectorial: Record<string, number> = {};
      reporte.performancePorActivo.forEach(pos => {
        const s = sectores[pos.ticker]?.sector || 'Otros';
        expSectorial[s] = (expSectorial[s] || 0) + pos.costoTotal;
      });
      const totalCosto = Object.values(expSectorial).reduce((a, b) => a + b, 0);
      const expPct: Record<string, number> = {};
      Object.entries(expSectorial).forEach(([s, v]) => {
        expPct[s] = totalCosto > 0 ? +(v / totalCosto * 100).toFixed(1) : 0;
      });

      const res = await fetch('/api/ai-reporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo: reporte.periodo,
          fechaInicio: reporte.fechaInicio,
          fechaFin: reporte.fechaFin,
          capitalInicial: reporte.capitalInicial,
          capitalActual,
          retornoPeriodo,
          retornoTotal: retornoPeriodo,
          volatilidad: reporte.volatilidad,
          maxDrawdown: reporte.maxDrawdown,
          sharpe,
          performancePorActivo: reporte.performancePorActivo,
          exposicionSectorial: expPct,
          capitalCaucionado: reporte.capitalCaucionado,
          interesesCauciones: reporte.interesesCauciones,
          tnaPromedio: reporte.tnaPromedio,
          dividendosPeriodo: reporte.dividendosPeriodo,
          benchmarks: null,
        }),
      });
      const iaRes = await res.json();
      if (iaRes.error) throw new Error(iaRes.error);
      setIAData(iaRes);
    } catch (e: any) {
      setIAError(e.message || 'Error al generar análisis IA');
    }
    setIALoading(false);
  }

  function descargarPDF() { window.print(); }

  const mep = reporte?.mep || 1430;
  const efectivo = reporte?.efectivoUSD || 0;

  const capitalActivo = reporte
    ? reporte.performancePorActivo.reduce((sum, pos) => {
        const precioUSD = precios[pos.ticker]?.precio ?? null;
        return sum + (precioUSD != null ? precioUSD * pos.cantidad : pos.costoTotal);
      }, 0)
    : 0;

  const capitalActual = capitalActivo + (reporte?.interesesCauciones || 0) + efectivo;

  const retornoPeriodo = reporte && reporte.capitalInicial > 0
    ? (capitalActual - reporte.capitalInicial) / reporte.capitalInicial * 100
    : null;

  const sharpe = reporte?.volatilidad && reporte.volatilidad > 0 && retornoPeriodo != null
    ? +((retornoPeriodo - 4.5) / reporte.volatilidad).toFixed(2)
    : null;

  const expSectorial: Record<string, number> = {};
  if (reporte) {
    reporte.performancePorActivo.forEach(pos => {
      const s = sectores[pos.ticker]?.sector || 'Otros';
      expSectorial[s] = (expSectorial[s] || 0) + pos.costoTotal;
    });
  }
  const totalCostoSect = Object.values(expSectorial).reduce((a, b) => a + b, 0);
  const sectorData = Object.entries(expSectorial)
    .map(([sector, valor]) => ({
      sector,
      valor,
      pct: totalCostoSect > 0 ? +(valor / totalCostoSect * 100).toFixed(1) : 0,
      color: SECTOR_COLORS[sector] || '#475569',
    }))
    .sort((a, b) => b.valor - a.valor);

  const perfData = reporte
    ? reporte.performancePorActivo.map(pos => {
        const precioUSD = precios[pos.ticker]?.precio ?? null;
        const valorActual = precioUSD != null ? precioUSD * pos.cantidad : null;
        const plPrecio = valorActual != null ? valorActual - pos.costoTotal : null;
        const plTotal = plPrecio != null ? plPrecio + pos.dividendos : null;
        const plPctTotal = plPrecio != null && pos.costoTotal > 0
          ? (plPrecio / pos.costoTotal) * 100
          : null;
        const retPeriodo = historicos[pos.ticker]?.retornoPeriodo ?? null;
        return { ...pos, precioUSD, valorActual, plPrecio, plTotal, plPctTotal, retPeriodo };
      }).sort((a, b) => (b.retPeriodo ?? b.plPctTotal ?? 0) - (a.retPeriodo ?? a.plPctTotal ?? 0))
    : [];

  const histLoaded = Object.keys(historicos).length > 0;

  const SESGO_COLOR: Record<string, string> = {
    'Alcista': 'var(--green)', 'Neutral': 'var(--amber)', 'Bajista': 'var(--red)',
  };
  const CONFIANZA_COLOR: Record<string, string> = {
    'Alta': 'var(--green)', 'Media': 'var(--amber)', 'Baja': 'var(--red)',
  };

  const periodoLabel = () => {
    const map: Record<string, string> = {
      diario: 'Diario', semanal: 'Semanal', mensual: 'Mensual',
      anual: 'Anual', historico: 'Histórico', custom: 'Personalizado',
    };
    return map[periodo] || periodo;
  };

  return (
    <div style={{ maxWidth: '1100px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: isMobile ? '20px' : '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Reportes</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Análisis de rendimiento de tu portfolio</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {reporte && (
            <button onClick={cargarReporte} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
              <RefreshCw size={14} /> Actualizar
            </button>
          )}
          {reporte && (
            <button onClick={descargarPDF} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
              <Download size={14} /> Descargar PDF
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {PERIODOS.map(p => (
          <button key={p.key} onClick={() => setPeriodo(p.key)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: periodo === p.key ? 'var(--violet)' : 'var(--surface)', border: `1px solid ${periodo === p.key ? 'var(--violet)' : 'var(--border)'}`, color: periodo === p.key ? '#fff' : 'var(--text2)', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>
            <span>{p.icon}</span> {!isMobile && p.label}
          </button>
        ))}
      </div>

      {periodo === 'custom' && (
        <div className="card" style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--muted2)' }}>Desde</label>
            <input type="date" value={customInicio} onChange={e => setCustomInicio(e.target.value)} className="input-field" style={{ width: '160px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--muted2)' }}>Hasta</label>
            <input type="date" value={customFin} onChange={e => setCustomFin(e.target.value)} className="input-field" style={{ width: '160px' }} />
          </div>
          <button onClick={cargarReporte} disabled={!customInicio || !customFin || loading}
            className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Calendar size={14} /> Generar
          </button>
        </div>
      )}

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--muted2)', fontSize: '14px' }}>Calculando reporte...</div>
        </div>
      )}

      {error && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '48px', borderColor: 'rgba(244,63,94,0.3)' }}>
          <div style={{ color: 'var(--red)', fontSize: '14px' }}>{error}</div>
        </div>
      )}

      {!userId && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>🔒</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>Iniciá sesión para ver tu reporte</div>
        </div>
      )}

      {reporte && !loading && (
        <>
          <div style={{ background: 'linear-gradient(135deg, #1a0a3d 0%, #0d0d1c 100%)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: '12px', padding: '20px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: 'var(--violet-light)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
                📋 Reporte {periodoLabel()}
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
                {new Date(reporte.fechaInicio).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })} → {new Date(reporte.fechaFin).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted2)', marginTop: '4px', fontFamily: 'DM Mono, monospace' }}>
                {reporte.totalOps} operaciones totales · {reporte.opsPeriodoCount} en el período · MEP ${mep.toLocaleString('es-AR')}
              </div>
            </div>
            {reporte.capitalCaucionado > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: 'var(--amber)' }}>
                🔒 Cauciones integradas
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : 5}, 1fr)`, gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'Retorno período', value: fmtPct(retornoPeriodo), color: colorV(retornoPeriodo) },
              { label: 'Capital actual', value: fmtUSD(capitalActual), color: 'var(--violet-light)' },
              { label: 'Capital inicial', value: fmtUSD(reporte.capitalInicial), color: 'var(--text)' },
              { label: 'Liquidez', value: fmtUSD(efectivo), color: '#06b6d4' },
              { label: 'Sharpe ratio', value: sharpe != null ? sharpe.toFixed(2) : '—', color: sharpe != null && sharpe > 1 ? 'var(--green)' : sharpe != null && sharpe < 0 ? 'var(--red)' : 'var(--amber)' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontFamily: 'DM Sans, sans-serif' }}>{m.label}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '14px' : '18px', fontWeight: 700, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>📈 Evolución del capital invertido</div>
              {reporte.historialCapital.length > 1 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={reporte.historialCapital} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="fecha" tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
                      tickFormatter={v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; }}
                      interval="preserveStartEnd" />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={45} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(v: number) => [fmtUSD(v), 'Invertido']}
                      labelFormatter={v => new Date(v).toLocaleDateString('es-AR')} />
                    <Line type="monotone" dataKey="valor" stroke="var(--violet)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '13px' }}>Sin suficientes datos</div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600 }}>🏆 Performance por activo</div>
                <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>
                  {histLoaded ? `rendimiento ${periodoLabel().toLowerCase()}` : 'cargando históricos...'}
                </div>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {perfData.length > 0 ? perfData.slice(0, 12).map(pos => {
                  const val = pos.retPeriodo ?? pos.plPctTotal;
                  return (
                    <div key={pos.ticker} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: 'var(--text)', width: '56px', flexShrink: 0 }}>{pos.ticker}</div>
                      <div style={{ flex: 1, height: '8px', background: 'var(--surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: '4px', background: val != null && val >= 0 ? 'var(--green)' : 'var(--red)', width: `${Math.min(Math.abs(val || 0), 100)}%` }} />
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorV(val), width: '60px', textAlign: 'right', flexShrink: 0 }}>
                        {val != null ? fmtPct(val) : <span style={{ color: 'var(--muted)' }}>...</span>}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Cargando precios...</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>🛡️ Métricas de riesgo</div>
              {[
                { label: 'Volatilidad anualiz.', value: reporte.volatilidad != null ? `${reporte.volatilidad.toFixed(1)}%` : '—', color: reporte.volatilidad != null && reporte.volatilidad > 20 ? 'var(--red)' : 'var(--amber)' },
                { label: 'Max Drawdown', value: `${reporte.maxDrawdown.toFixed(2)}%`, color: reporte.maxDrawdown < -10 ? 'var(--red)' : 'var(--amber)' },
                { label: 'Sharpe ratio', value: sharpe != null ? sharpe.toFixed(2) : '—', color: sharpe != null && sharpe > 1 ? 'var(--green)' : 'var(--red)' },
                { label: 'Operaciones', value: reporte.opsPeriodoCount.toString(), color: 'var(--text)' },
              ].map(m => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{m.label}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', fontWeight: 600, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>🗂️ Exposición sectorial</div>
              {sectorData.length > 0 ? sectorData.map(s => (
                <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text2)', width: '90px', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sector}</div>
                  <div style={{ flex: 1, height: '6px', background: 'var(--surface2)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '3px', background: s.color, width: `${s.pct}%` }} />
                  </div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text)', width: '36px', textAlign: 'right', flexShrink: 0 }}>{s.pct}%</div>
                </div>
              )) : (
                <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Cargando sectores...</div>
              )}
            </div>

            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>🔒 Cauciones del período</div>
              {reporte.capitalCaucionado > 0 ? (
                <>
                  {[
                    { label: 'Capital caucionado', value: fmtUSD(reporte.capitalCaucionado), color: 'var(--violet-light)' },
                    { label: 'Intereses devengados', value: fmtUSD(reporte.interesesCauciones), color: 'var(--green)' },
                    { label: 'TNA promedio', value: reporte.tnaPromedio != null ? `${reporte.tnaPromedio.toFixed(1)}%` : '—', color: 'var(--text)' },
                    { label: 'Dividendos cobrados', value: fmtUSD(reporte.dividendosPeriodo), color: 'var(--green)' },
                  ].map(m => (
                    <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{m.label}</span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', fontWeight: 600, color: m.color }}>{m.value}</span>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Sin cauciones en este período</div>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600 }}>📋 Posiciones abiertas</div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Rend. período · P&L total acumulado</div>
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    {['Ticker', 'Sector', 'Cantidad', 'Costo prom.', 'Precio USD', 'Valor actual', 'Rend. período', 'P&L total', 'Dividendos', 'P&L %'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: h === 'Ticker' || h === 'Sector' ? 'left' : 'right', whiteSpace: 'nowrap', fontFamily: 'DM Sans, sans-serif', fontSize: '12px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perfData.map((pos, i) => (
                    <tr key={pos.ticker} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 16px', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{pos.ticker}</div>
                        <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'DM Sans, sans-serif' }}>{pos.broker}</div>
                      </td>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '11px', background: `${SECTOR_COLORS[sectores[pos.ticker]?.sector || 'Otros']}20`, color: SECTOR_COLORS[sectores[pos.ticker]?.sector || 'Otros'] || 'var(--muted2)', border: `1px solid ${SECTOR_COLORS[sectores[pos.ticker]?.sector || 'Otros']}40`, borderRadius: '4px', padding: '2px 6px' }}>
                          {sectores[pos.ticker]?.sector || '...'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{pos.cantidad.toFixed(2)}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text2)' }}>{fmtUSD(pos.costoPromedio)}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>
                        {pos.precioUSD != null ? fmtUSD(pos.precioUSD) : <span style={{ color: 'var(--muted)' }}>...</span>}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>
                        {pos.valorActual != null ? fmtUSD(pos.valorActual) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.retPeriodo), fontWeight: 600 }}>
                        {pos.retPeriodo != null ? fmtPct(pos.retPeriodo) : <span style={{ color: 'var(--muted)' }}>...</span>}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.plTotal) }}>
                        {pos.plTotal != null ? fmtUSD(pos.plTotal) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--green)' }}>
                        {pos.dividendos > 0 ? fmtUSD(pos.dividendos) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.plPctTotal), fontWeight: 600 }}>
                        {pos.plPctTotal != null ? fmtPct(pos.plPctTotal) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {perfData.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                      <td colSpan={5} style={{ padding: '10px 16px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text)', fontSize: '13px' }}>Total</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>
                        {fmtUSD(perfData.reduce((s, p) => s + (p.valorActual || 0), 0))}
                      </td>
                      <td />
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: colorV(perfData.reduce((s, p) => s + (p.plTotal || 0), 0)) }}>
                        {fmtUSD(perfData.reduce((s, p) => s + (p.plTotal || 0), 0))}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--green)' }}>
                        {fmtUSD(perfData.reduce((s, p) => s + (p.dividendos || 0), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>✨ Análisis IA del período</div>
            {!iaData && !iaLoading && (
              <div style={{ textAlign: 'center', padding: '32px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>🤖</div>
                <div style={{ fontSize: '13px', color: 'var(--muted2)', marginBottom: '20px', fontFamily: 'DM Sans, sans-serif' }}>
                  Generá un análisis inteligente de tu portfolio para este período.
                </div>
                <button onClick={generarIA} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}>
                  <Sparkles size={16} /> Generar análisis IA
                </button>
                {iaError && <div style={{ marginTop: '12px', color: 'var(--red)', fontSize: '13px' }}>{iaError}</div>}
              </div>
            )}
            {iaLoading && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
                Analizando portfolio con IA...
              </div>
            )}
            {iaData && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '6px' }}>Sesgo</div>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: SESGO_COLOR[iaData.sesgo] || 'var(--text)' }}>{iaData.sesgo}</div>
                  </div>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '6px' }}>Confianza</div>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: CONFIANZA_COLOR[iaData.confianza] || 'var(--text)' }}>{iaData.confianza}</div>
                  </div>
                  <div style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(167,139,250,0.05) 100%)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px', padding: '12px', textAlign: 'center', gridColumn: isMobile ? '1 / -1' : 'auto' }}>
                    <div style={{ fontSize: '11px', color: 'var(--violet-light)', marginBottom: '6px' }}>Modelo</div>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--violet-light)' }}>Llama 3.3 70B</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--violet-light)', marginBottom: '8px' }}>Resumen ejecutivo</div>
                  <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.7', fontFamily: 'DM Sans, sans-serif' }}>{iaData.resumen_ejecutivo}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>📊 Rendimiento</div>
                    <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{iaData.analisis_rendimiento}</div>
                  </div>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>🛡️ Riesgo</div>
                    <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{iaData.analisis_riesgo}</div>
                  </div>
                </div>

                {iaData.cauciones && (
                  <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--amber)', marginBottom: '8px' }}>🔒 Cauciones</div>
                    <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{iaData.cauciones}</div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--green)', marginBottom: '10px' }}>💡 Recomendaciones</div>
                    {iaData.recomendaciones.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px', color: 'var(--green)', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>{i + 1}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{r}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--red)', marginBottom: '10px' }}>⚠️ Alertas</div>
                    {iaData.alertas.filter(a => a).map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                        <AlertTriangle size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{a}</div>
                      </div>
                    ))}
                    {iaData.alertas.filter(a => a).length === 0 && (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <CheckCircle size={16} style={{ color: 'var(--green)' }} />
                        <span style={{ fontSize: '13px', color: 'var(--muted2)' }}>Sin alertas relevantes</span>
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={() => { setIAData(null); setIAError(null); }}
                  style={{ marginTop: '12px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RefreshCw size={13} /> Regenerar análisis
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

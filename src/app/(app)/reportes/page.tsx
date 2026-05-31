'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Download, RefreshCw, Sparkles, Calendar, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell } from 'recharts';
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
  { key: 'diario',    label: 'Diario',       icon: '📅' },
  { key: 'semanal',   label: 'Semanal',      icon: '📆' },
  { key: 'mensual',   label: 'Mensual',      icon: '🗓️' },
  { key: 'anual',     label: 'Anual',        icon: '📊' },
  { key: 'historico', label: 'Histórico',    icon: '📈' },
  { key: 'custom',    label: 'Personalizado', icon: '🎯' },
];

const fmtUSD = (n: number | null | undefined) =>
  n == null ? '—' : 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const colorV = (n: number | null | undefined) =>
  n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const SECTOR_COLORS: Record<string, string> = {
  'Tecnología':      '#7c3aed',
  'Financiero':      '#06b6d4',
  'Energía':         '#f59e0b',
  'Consumo':         '#10b981',
  'Salud':           '#ec4899',
  'Industriales':    '#8b5cf6',
  'Materiales':      '#f97316',
  'Comunicaciones':  '#14b8a6',
  'Real Estate':     '#a3e635',
  'Renta Fija':      '#94a3b8',
  'Cripto':          '#f43f5e',
  'Otros':           '#475569',
};

interface ReporteData {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  capitalInicial: number;
  depositosPeriodo: number;
  retirosPeriodo: number;
  dividendosPeriodo: number;
  plRealizado: number;
  capitalCaucionado: number;
  interesesCauciones: number;
  tnaPromedio: number | null;
  tickersAbiertos: string[];
  performancePorActivo: {
    ticker: string; cantidad: number; costoTotal: number;
    costoPromedio: number; dividendos: number; tipo: string; broker: string;
  }[];
  historialCapital: { fecha: string; valor: number }[];
  retornosMensuales: { mes: string; retorno: number | null }[];
  volatilidad: number | null;
  maxDrawdown: number;
  totalOps: number;
  opsPeriodoCount: number;
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
  const [precios, setPrecios] = useState<Record<string, number | null>>({});
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

      // Cargar sectores y precios en paralelo
      if (data.tickersAbiertos?.length) {
        cargarSectores(data.tickersAbiertos);
        cargarPrecios(data.tickersAbiertos);
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

  async function cargarPrecios(tickers: string[]) {
    const preciosMap: Record<string, number | null> = {};
    await Promise.all(
      tickers.map(async ticker => {
        try {
          const res = await fetch(`/api/buscar?ticker=${ticker}`);
          const data = await res.json();
          const precio = data.tipo === 'cedear'
            ? data.precio?.valor
            : (data.precio?.valor ?? data.precio);
          preciosMap[ticker] = typeof precio === 'number' ? precio : null;
        } catch {
          preciosMap[ticker] = null;
        }
      })
    );
    setPrecios(preciosMap);
  }

  async function generarIA() {
    if (!reporte) return;
    setIALoading(true);
    setIAError(null);
    try {
      // Calcular capital actual con precios
      const capitalActivo = reporte.performancePorActivo.reduce((sum, pos) => {
        const precio = precios[pos.ticker];
        return sum + (precio != null ? precio * pos.cantidad : pos.costoTotal);
      }, 0);
      const capitalActual = capitalActivo + reporte.interesesCauciones;
      const retornoPeriodo = reporte.capitalInicial > 0
        ? (capitalActual - reporte.capitalInicial) / reporte.capitalInicial * 100
        : null;
      const sharpe = reporte.volatilidad && reporte.volatilidad > 0 && retornoPeriodo != null
        ? +((retornoPeriodo - 4.5) / reporte.volatilidad).toFixed(2)
        : null;

      // Exposición sectorial
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
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setIAData(data);
    } catch (e: any) {
      setIAError(e.message || 'Error al generar análisis IA');
    }
    setIALoading(false);
  }

  function descargarPDF() {
    window.print();
  }

  // Calcular métricas derivadas
  const capitalActivo = reporte
    ? reporte.performancePorActivo.reduce((sum, pos) => {
        const precio = precios[pos.ticker];
        return sum + (precio != null ? precio * pos.cantidad : pos.costoTotal);
      }, 0)
    : 0;
  const capitalActual = capitalActivo + (reporte?.interesesCauciones || 0);
  const retornoPeriodo = reporte && reporte.capitalInicial > 0
    ? (capitalActual - reporte.capitalInicial) / reporte.capitalInicial * 100
    : null;
  const sharpe = reporte?.volatilidad && reporte.volatilidad > 0 && retornoPeriodo != null
    ? +((retornoPeriodo - 4.5) / reporte.volatilidad).toFixed(2)
    : null;

  // Exposición sectorial calculada
  const expSectorial: Record<string, number> = {};
  if (reporte) {
    reporte.performancePorActivo.forEach(pos => {
      const s = sectores[pos.ticker]?.sector || 'Otros';
      expSectorial[s] = (expSectorial[s] || 0) + pos.costoTotal;
    });
  }
  const totalCosto = Object.values(expSectorial).reduce((a, b) => a + b, 0);
  const sectorData = Object.entries(expSectorial)
    .map(([sector, valor]) => ({
      sector,
      valor,
      pct: totalCosto > 0 ? +(valor / totalCosto * 100).toFixed(1) : 0,
      color: SECTOR_COLORS[sector] || '#475569',
    }))
    .sort((a, b) => b.valor - a.valor);

  // Performance por activo con P&L
  const perfData = reporte
    ? reporte.performancePorActivo.map(pos => {
        const precioActual = precios[pos.ticker];
        const valorActual = precioActual != null ? precioActual * pos.cantidad : null;
        const plPrecio = valorActual != null ? valorActual - pos.costoTotal : null;
        const plTotal = plPrecio != null ? plPrecio + pos.dividendos : null;
        const plPct = plPrecio != null && pos.costoTotal > 0
          ? (plPrecio / pos.costoTotal) * 100
          : null;
        return { ...pos, precioActual, valorActual, plPrecio, plTotal, plPct };
      }).sort((a, b) => (b.plPct || 0) - (a.plPct || 0))
    : [];

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
      {/* Header */}
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

      {/* Selector de período */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {PERIODOS.map(p => (
          <button key={p.key} onClick={() => setPeriodo(p.key)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: periodo === p.key ? 'var(--violet)' : 'var(--surface)', border: `1px solid ${periodo === p.key ? 'var(--violet)' : 'var(--border)'}`, color: periodo === p.key ? '#fff' : 'var(--text2)', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>
            <span>{p.icon}</span> {!isMobile && p.label}
          </button>
        ))}
      </div>

      {/* Rango custom */}
      {periodo === 'custom' && (
        <div className="card" style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'DM Sans, sans-serif' }}>Desde</label>
            <input type="date" value={customInicio} onChange={e => setCustomInicio(e.target.value)}
              className="input-field" style={{ width: '160px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'DM Sans, sans-serif' }}>Hasta</label>
            <input type="date" value={customFin} onChange={e => setCustomFin(e.target.value)}
              className="input-field" style={{ width: '160px' }} />
          </div>
          <button onClick={cargarReporte} disabled={!customInicio || !customFin || loading}
            className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Calendar size={14} /> Generar
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--muted2)', fontSize: '14px' }}>Calculando reporte...</div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '48px', borderColor: 'rgba(244,63,94,0.3)' }}>
          <div style={{ color: 'var(--red)', fontSize: '14px', fontFamily: 'DM Sans, sans-serif' }}>{error}</div>
        </div>
      )}

      {/* Sin usuario */}
      {!userId && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>🔒</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>Iniciá sesión para ver tu reporte</div>
        </div>
      )}

      {/* Contenido del reporte */}
      {reporte && !loading && (
        <>
          {/* Header del reporte */}
          <div style={{ background: 'linear-gradient(135deg, #1a0a3d 0%, #0d0d1c 100%)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: '12px', padding: '20px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: 'var(--violet-light)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
                📋 Reporte {periodoLabel()}
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
                {new Date(reporte.fechaInicio).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })} → {new Date(reporte.fechaFin).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted2)', marginTop: '4px', fontFamily: 'DM Mono, monospace' }}>
                {reporte.totalOps} operaciones totales · {reporte.opsPeriodoCount} en el período
              </div>
            </div>
            {reporte.capitalCaucionado > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: 'var(--amber)' }}>
                🔒 Cauciones integradas
              </div>
            )}
          </div>

          {/* Métricas principales */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 2 : 5}, 1fr)`, gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'Retorno período', value: fmtPct(retornoPeriodo), color: colorV(retornoPeriodo) },
              { label: 'Capital actual', value: fmtUSD(capitalActual), color: 'var(--violet-light)' },
              { label: 'Capital inicial', value: fmtUSD(reporte.capitalInicial), color: 'var(--text)' },
              { label: 'Dividendos', value: fmtUSD(reporte.dividendosPeriodo), color: 'var(--green)' },
              { label: 'Sharpe ratio', value: sharpe != null ? sharpe.toFixed(2) : '—', color: sharpe != null && sharpe > 1 ? 'var(--green)' : sharpe != null && sharpe < 0 ? 'var(--red)' : 'var(--amber)' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontFamily: 'DM Sans, sans-serif' }}>{m.label}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '14px' : '18px', fontWeight: 700, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Evolución + Performance */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '16px' }}>

            {/* Gráfico evolución */}
            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>📈 Evolución del capital</div>
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
                      formatter={(v: number) => [fmtUSD(v), 'Capital']}
                      labelFormatter={v => new Date(v).toLocaleDateString('es-AR')} />
                    <Line type="monotone" dataKey="valor" stroke="var(--violet)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '13px' }}>Sin suficientes datos para el gráfico</div>
              )}
            </div>

            {/* Performance por activo */}
            <div className="card">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>🏆 Performance por activo</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {perfData.slice(0, 10).map(pos => (
                  <div key={pos.ticker} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: 'var(--text)', width: '52px', flexShrink: 0 }}>{pos.ticker}</div>
                    <div style={{ flex: 1, height: '8px', background: 'var(--surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: '4px', background: pos.plPct != null && pos.plPct >= 0 ? 'var(--green)' : 'var(--red)', width: `${Math.min(Math.abs(pos.plPct || 0), 100)}%` }} />
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorV(pos.plPct), width: '52px', textAlign: 'right', flexShrink: 0 }}>{fmtPct(pos.plPct)}</div>
                  </div>
                ))}
                {perfData.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Cargando precios...</div>}
              </div>
            </div>
          </div>

          {/* Métricas de riesgo + Sectores + Cauciones */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>

            {/* Riesgo */}
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

            {/* Sectores */}
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

            {/* Cauciones */}
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

          {/* Tabla de posiciones */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600 }}>📋 Posiciones abiertas</div>
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    {['Ticker', 'Sector', 'Cantidad', 'Costo prom.', 'Precio actual', 'Valor actual', 'P&L precio', 'Dividendos', 'P&L total', 'P&L %'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: h === 'Ticker' || h === 'Sector' ? 'left' : 'right', whiteSpace: 'nowrap', fontFamily: 'DM Sans, sans-serif', fontSize: '12px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perfData.map((pos, i) => (
                    <tr key={pos.ticker} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 16px', position: 'sticky', left: 0, background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface)', zIndex: 1 }}>
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
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{pos.precioActual != null ? fmtUSD(pos.precioActual) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{pos.valorActual != null ? fmtUSD(pos.valorActual) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.plPrecio) }}>{pos.plPrecio != null ? fmtUSD(pos.plPrecio) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--green)' }}>{fmtUSD(pos.dividendos)}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.plTotal) }}>{pos.plTotal != null ? fmtUSD(pos.plTotal) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: colorV(pos.plPct), fontWeight: 600 }}>{fmtPct(pos.plPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Análisis IA */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text2)', fontWeight: 600, marginBottom: '14px' }}>✨ Análisis IA del período</div>
            {!iaData && !iaLoading && (
              <div style={{ textAlign: 'center', padding: '32px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>🤖</div>
                <div style={{ fontSize: '13px', color: 'var(--muted2)', marginBottom: '20px', fontFamily: 'DM Sans, sans-serif' }}>Generá un análisis inteligente de tu portfolio para este período.</div>
                <button onClick={generarIA} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}>
                  <Sparkles size={16} /> Generar análisis IA
                </button>
                {iaError && <div style={{ marginTop: '12px', color: 'var(--red)', fontSize: '13px' }}>{iaError}</div>}
              </div>
            )}
            {iaLoading && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>Analizando portfolio con IA...</div>
            )}
            {iaData && (
              <div>
                {/* Sesgo y confianza */}
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

                {/* Resumen ejecutivo */}
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
                  {/* Recomendaciones */}
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--green)', marginBottom: '10px' }}>💡 Recomendaciones</div>
                    {iaData.recomendaciones.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px', color: 'var(--green)', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>{i + 1}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{r}</div>
                      </div>
                    ))}
                  </div>

                  {/* Alertas */}
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

                <button onClick={() => { setIAData(null); setIAError(null); }} style={{ marginTop: '12px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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

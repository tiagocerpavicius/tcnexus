'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, RefreshCw, Search, ChevronRight, Sparkles } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';

const COLORS = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#a3e635'];
type Tab = 'precios' | 'fundamentales' | 'correlacion' | 'graficos' | 'analistas' | 'ia';
const LS_KEY = 'tcnexus_dashboard_tickers';

interface Hist { fecha: string; cierre: number; }
interface TickerItem {
  ticker: string; nombre: string | null; tipo: string; moneda: string;
  precio: number | null; variacion: number | null;
  usTicker: string; sufixFundamentals: string;
  marketCap: number | null; per: number | null; eps: number | null; beta: number | null;
  maximo52: number | null; minimo52: number | null;
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
  numAnalistas: number | null;
  historico: Hist[] | null;
  varMensual: number | null; varAnual: number | null; volatilidad: number | null;
  loading: boolean; loadingFunds: boolean; loadingHistory: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtUSD = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtM   = (n: number | null) => { if (n == null) return '—'; if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(2)+'T'; if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2)+'B'; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M'; return n.toLocaleString(); };
const fmtNum = (n: number | null) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';
const fmtP   = (n: number | null, m: string) => n == null ? '—' : m === 'ARS' ? fmtARS(n) : fmtUSD(n);

function retornos(h: Hist[]) { return h.slice(1).map((d, i) => (d.cierre - h[i].cierre) / h[i].cierre); }
function volatilidad(h: Hist[]): number | null {
  if (h.length < 10) return null;
  const r = retornos(h); const mean = r.reduce((a,b)=>a+b,0)/r.length;
  return +(Math.sqrt(r.reduce((a,v)=>a+(v-mean)**2,0)/r.length)*Math.sqrt(252)*100).toFixed(2);
}
function varPeriodo(h: Hist[], dias: number): number | null {
  if (h.length < 2) return null;
  const hoy = h[h.length - 1].cierre;
  const corte = new Date();
  corte.setDate(corte.getDate() - dias);
  const corteStr = corte.toISOString().split('T')[0];
  const pasado = [...h].reverse().find(d => d.fecha <= corteStr);
  if (!pasado) {
    if (dias >= 300) return +((hoy - h[0].cierre) / h[0].cierre * 100).toFixed(2);
    return null;
  }
  return +((hoy - pasado.cierre) / pasado.cierre * 100).toFixed(2);
}
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); if (n < 5) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((s,v)=>s+v,0)/n, mb = bx.reduce((s,v)=>s+v,0)/n;
  let num=0,da=0,db=0;
  for (let i=0;i<n;i++){num+=(ax[i]-ma)*(bx[i]-mb);da+=(ax[i]-ma)**2;db+=(bx[i]-mb)**2;}
  return da===0||db===0?0:+(num/Math.sqrt(da*db)).toFixed(2);
}
function corrColor(v: number) {
  if (v>=0.8) return '#22c55e'; if (v>=0.5) return '#86efac';
  if (v>=0.2) return '#f59e0b'; if (v>=-0.2) return '#64748b';
  if (v>=-0.5) return '#f87171'; return '#ef4444';
}

// ── Tab: Precios ─────────────────────────────────────────────────────────────
function TabPrecios({ items, onSelect }: { items: TickerItem[]; onSelect: (t: string) => void }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div className="label-xs">📈 Precios y Rendimiento</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>Variaciones calculadas sobre datos históricos del último año</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {['Activo','Precio','Var. Diaria','Var. Mensual','Var. Anual','Volatilidad',''].map(h => (
                <th key={h} style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: h === 'Activo' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t, i) => (
              <tr key={t.ticker} onClick={() => onSelect(t.ticker)}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <div>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>{t.ticker}</div>
                      {t.nombre && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Sans, sans-serif' }}>{t.nombre}</div>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text)', fontWeight: 500 }}>
                  {t.loading ? <span style={{ color: 'var(--muted)' }}>...</span> : fmtP(t.precio, t.moneda)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(t.variacion) }}>{t.loading ? '...' : fmtPct(t.variacion)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(t.varMensual) }}>
                  {t.loadingHistory ? <span style={{ color: 'var(--muted)', fontSize: '11px' }}>cargando</span> : fmtPct(t.varMensual)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: colorV(t.varAnual) }}>
                  {t.loadingHistory ? <span style={{ color: 'var(--muted)', fontSize: '11px' }}>cargando</span> : fmtPct(t.varAnual)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text2)' }}>
                  {t.loadingHistory ? '...' : t.volatilidad != null ? `${t.volatilidad.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}><ChevronRight size={14} color="var(--muted)" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Fundamentales ───────────────────────────────────────────────────────
function TabFundamentales({ items }: { items: TickerItem[] }) {
  const metrics = [
    { key: 'marketCap', label: 'Market Cap',    fmt: fmtM,    hi: true  },
    { key: 'per',       label: 'P/E Ratio',     fmt: fmtNum,  hi: false },
    { key: 'eps',       label: 'EPS (USD)',      fmt: (v: any) => v != null ? '$'+Number(v).toFixed(2) : '—', hi: true },
    { key: 'beta',      label: 'Beta',           fmt: fmtNum,  hi: null  },
    { key: 'maximo52',  label: 'Máx. 52 sem.',  fmt: fmtUSD,  hi: true  },
    { key: 'minimo52',  label: 'Mín. 52 sem.',  fmt: fmtUSD,  hi: false },
  ] as const;

  function best(key: string, hi: boolean | null): string | null {
    if (hi === null) return null;
    const vals = items.map(t => ({ ticker: t.ticker, val: (t as any)[key] as number | null })).filter(x => x.val != null);
    if (!vals.length) return null;
    return hi ? vals.reduce((a,b) => a.val! > b.val! ? a : b).ticker
              : vals.reduce((a,b) => a.val! < b.val! ? a : b).ticker;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div className="label-xs">📊 Indicadores Fundamentales</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>Comparativa de métricas clave · <span style={{ color: 'var(--green)' }}>Verde = mejor del grupo</span></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <th style={{ padding: '10px 16px', color: 'var(--muted2)', fontWeight: 400, textAlign: 'left' }}>Indicador</th>
              {items.map((t, i) => (
                <th key={t.ticker} style={{ padding: '10px 16px', color: COLORS[i % COLORS.length], fontWeight: 600, textAlign: 'right' }}>{t.ticker}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m, mi) => {
              const b = best(m.key, m.hi as any);
              return (
                <tr key={m.key} style={{ borderBottom: '1px solid var(--border)', background: mi%2===0?'transparent':'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)', fontFamily: 'DM Sans, sans-serif' }}>{m.label}</td>
                  {items.map(t => {
                    const val = (t as any)[m.key];
                    const isBest = b === t.ticker;
                    return (
                      <td key={t.ticker} style={{ padding: '12px 16px', textAlign: 'right', color: isBest ? 'var(--green)' : val==null ? 'var(--muted)' : 'var(--text)', fontWeight: isBest ? 600 : 400 }}>
                        {t.loadingFunds ? <span style={{ color: 'var(--muted)', fontSize: '11px' }}>cargando</span> : (m.fmt as any)(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Correlación ─────────────────────────────────────────────────────────
function TabCorrelacion({ items }: { items: TickerItem[] }) {
  const withH = items.filter(t => t.historico && t.historico.length > 10);
  if (items.some(t => t.loadingHistory)) return <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace', padding: '40px', textAlign: 'center' }}>Calculando correlaciones...</div>;
  if (withH.length < 2) return (
    <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
      <div style={{ color: 'var(--muted2)', fontSize: '14px' }}>Se necesitan al menos 2 activos con datos históricos.</div>
    </div>
  );
  const rets = withH.map(t => retornos(t.historico!));
  const matrix = withH.map((_, i) => withH.map((__, j) => pearson(rets[i], rets[j])));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div className="label-xs">🔗 Matriz de Correlación</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>Cómo se mueven los precios entre sí (1 = juntos · -1 = opuestos)</div>
      </div>
      <div style={{ padding: '20px', overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 16px' }}></th>
              {withH.map((t, i) => <th key={t.ticker} style={{ padding: '8px 16px', color: COLORS[i%COLORS.length], fontWeight: 600, textAlign: 'center', minWidth: '90px' }}>{t.ticker}</th>)}
            </tr>
          </thead>
          <tbody>
            {withH.map((t, i) => (
              <tr key={t.ticker}>
                <td style={{ padding: '8px 16px', color: COLORS[i%COLORS.length], fontWeight: 600 }}>{t.ticker}</td>
                {matrix[i].map((val, j) => (
                  <td key={j} style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ background: corrColor(val), borderRadius: '8px', padding: '8px 12px', fontWeight: val===1?700:500, color: '#000', fontSize: '13px' }}>
                      {val.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[['#22c55e','≥ 0.8 Alta'],['#86efac','0.5–0.8 Moderada'],['#f59e0b','0.2–0.5 Baja'],['#64748b','-0.2–0.2 Nula'],['#f87171','-0.5–-0.2 Inv. baja'],['#ef4444','< -0.5 Inv. alta']].map(([c,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: c }} />
              <span style={{ fontSize: '11px', color: 'var(--muted2)', fontFamily: 'DM Sans, sans-serif' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Gráficos ────────────────────────────────────────────────────────────
function TabGraficos({ items }: { items: TickerItem[] }) {
  const [rango, setRango] = useState<'7d'|'30d'|'3m'|'ytd'|'1y'>('1y');
  const [activos, setActivos] = useState<Set<string>>(() => new Set(items.map(t => t.ticker)));

  const withH = items.filter(t => t.historico && t.historico.length > 0);
  if (!withH.length) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px', fontFamily: 'DM Mono, monospace' }}>Cargando datos históricos...</div>;

  function filtrar(h: Hist[]): Hist[] {
    if (rango === 'ytd') { const ini = new Date(new Date().getFullYear(),0,1).toISOString().split('T')[0]; return h.filter(d => d.fecha >= ini); }
    const dias: Record<string,number> = {'7d':7,'30d':30,'3m':90,'1y':365};
    const corte = new Date(); corte.setDate(corte.getDate()-dias[rango]);
    return h.filter(d => new Date(d.fecha) >= corte);
  }
  function normalizar(h: Hist[]) {
    if (!h.length) return {};
    const base = h[0].cierre;
    const m: Record<string,number> = {};
    h.forEach(d => { m[d.fecha] = +((d.cierre-base)/base*100).toFixed(2); });
    return m;
  }

  const allDates = Array.from(new Set(withH.flatMap(t => filtrar(t.historico!).map(d => d.fecha)))).sort();
  const step = Math.max(1, Math.floor(allDates.length/200));
  const sampled = allDates.filter((_,i) => i%step===0 || i===allDates.length-1);

  const normMaps: Record<string,Record<string,number>> = {};
  withH.forEach(t => { normMaps[t.ticker] = normalizar(filtrar(t.historico!)); });

  const chartData = sampled.map(fecha => {
    const point: any = { fecha };
    withH.filter(t => activos.has(t.ticker)).forEach(t => { point[t.ticker] = normMaps[t.ticker]?.[fecha] ?? null; });
    return point;
  });

  const toggleTicker = (ticker: string) => setActivos(prev => {
    const s = new Set(prev);
    if (s.has(ticker)) { if (s.size > 1) s.delete(ticker); } else s.add(ticker);
    return s;
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="label-xs" style={{ marginBottom: '4px' }}>📉 Rendimiento Histórico</div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>% de cambio desde el inicio del período seleccionado</div>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--surface2)', borderRadius: '8px', padding: '4px' }}>
          {(['7d','30d','3m','ytd','1y'] as const).map(r => (
            <button key={r} onClick={() => setRango(r)} style={{ background: rango===r?'var(--violet)':'transparent', color: rango===r?'#fff':'var(--muted2)', border: 'none', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {withH.map((t, i) => (
          <button key={t.ticker} onClick={() => toggleTicker(t.ticker)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: activos.has(t.ticker) ? `${COLORS[i%COLORS.length]}20` : 'var(--surface2)', border: `1px solid ${activos.has(t.ticker) ? COLORS[i%COLORS.length] : 'var(--border)'}`, borderRadius: '20px', padding: '4px 12px', cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS[i%COLORS.length] }} />
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: activos.has(t.ticker) ? COLORS[i%COLORS.length] : 'var(--muted2)' }}>{t.ticker}</span>
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="fecha" tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
            tickFormatter={v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth()+1}/${String(d.getFullYear()).slice(-2)}`; }}
            interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
            tickFormatter={v => `${v>0?'+':''}${v.toFixed(0)}%`} width={55} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}
            formatter={(value: number, name: string) => [`${value>0?'+':''}${value?.toFixed(2)}%`, name]}
            labelFormatter={v => new Date(v).toLocaleDateString('es-AR')}
          />
          {withH.filter(t => activos.has(t.ticker)).map((t, i) => (
            <Line key={t.ticker} type="monotone" dataKey={t.ticker}
              stroke={COLORS[items.findIndex(it => it.ticker === t.ticker) % COLORS.length]}
              strokeWidth={2} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Tab: Analistas ───────────────────────────────────────────────────────────
function TabAnalistas({ items }: { items: TickerItem[] }) {
  const withData = items.filter(t => (t.strongBuy+t.buy+t.hold+t.sell+t.strongSell) > 0);
  if (!withData.length) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px', fontFamily: 'DM Mono, monospace' }}>No hay datos de analistas para los activos seleccionados.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
      {withData.map((t, ti) => {
        const total = t.strongBuy+t.buy+t.hold+t.sell+t.strongSell;
        const buyT = t.strongBuy+t.buy, sellT = t.sell+t.strongSell;
        let cons = 'Mantener', consC = '#f59e0b';
        if (buyT > t.hold && buyT > sellT) { cons = t.strongBuy>=t.buy?'Compra Fuerte':'Compra'; consC = '#22c55e'; }
        else if (sellT > t.hold && sellT > buyT) { cons = t.strongSell>=t.sell?'Venta Fuerte':'Venta'; consC = '#ef4444'; }
        const segs = [
          { l:'Compra Fuerte', v:t.strongBuy, c:'#22c55e' },
          { l:'Compra', v:t.buy, c:'#86efac' },
          { l:'Mantener', v:t.hold, c:'#f59e0b' },
          { l:'Venta', v:t.sell, c:'#f87171' },
          { l:'Venta Fuerte', v:t.strongSell, c:'#ef4444' },
        ].filter(s => s.v > 0);

        return (
          <div key={t.ticker} className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '16px', color: COLORS[ti%COLORS.length] }}>{t.ticker}</div>
                {t.nombre && <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{t.nombre}</div>}
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: consC, background: `${consC}18`, border: `1px solid ${consC}40`, borderRadius: '6px', padding: '4px 10px' }}>{cons}</div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginBottom: '10px' }}>{total} analistas</div>
            <div style={{ height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'flex', marginBottom: '12px' }}>
              {segs.map(s => <div key={s.l} style={{ flex: s.v, background: s.c }} title={`${s.l}: ${s.v}`} />)}
            </div>
            {segs.map(s => (
              <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: s.c, flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1, fontFamily: 'DM Sans, sans-serif' }}>{s.l}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text)' }}>{s.v}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)', minWidth: '32px', textAlign: 'right' }}>{((s.v/total)*100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Resumen IA ──────────────────────────────────────────────────────────
function TabIA({ items }: { items: TickerItem[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const generar = async () => {
    setLoading(true); setError(null);
    try {
      const payload = items.map(t => ({
        ticker: t.ticker, nombre: t.nombre, precio: t.precio, variacion: t.variacion,
        varMensual: t.varMensual, varAnual: t.varAnual, marketCap: t.marketCap,
        per: t.per, eps: t.eps, beta: t.beta,
        strongBuy: t.strongBuy, buy: t.buy, hold: t.hold, sell: t.sell, strongSell: t.strongSell,
        numAnalistas: t.numAnalistas,
      }));
      const res = await fetch('/api/ai-resumen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: payload }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) { setError(e.message || 'Error al generar el resumen'); }
    setLoading(false);
  };

  const EC: Record<string,string> = { 'Compra Fuerte':'#22c55e','Compra':'#86efac','Mantener':'#f59e0b','Reducir':'#f87171','Venta':'#ef4444' };
  const RC: Record<string,string> = { 'Bajo':'#22c55e','Moderado':'#f59e0b','Alto':'#ef4444' };
  const SC: Record<string,string> = { 'Alcista':'#22c55e','Neutral':'#f59e0b','Bajista':'#ef4444' };

  if (!result) return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
      <div style={{ fontSize: '36px', marginBottom: '16px' }}>🤖</div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>Resumen IA</div>
      <div style={{ fontSize: '13px', color: 'var(--muted2)', marginBottom: '24px' }}>
        Análisis automático de los {items.length} activos seleccionados usando inteligencia artificial.
      </div>
      <button onClick={generar} disabled={loading} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}>
        <Sparkles size={16} /> {loading ? 'Analizando...' : 'Generar Análisis'}
      </button>
      {error && <div style={{ marginTop: '16px', color: 'var(--red)', fontSize: '13px' }}>{error}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Riesgo general', value: result.riesgo_general, color: RC[result.riesgo_general] },
          { label: 'Sesgo de mercado', value: result.sesgo_mercado, color: SC[result.sesgo_mercado] },
          { label: 'Activo destacado', value: result.activo_destacado?.ticker, color: 'var(--violet-light)' },
        ].map(m => (
          <div key={m.label} className="card" style={{ textAlign: 'center' }}>
            <div className="label-xs" style={{ marginBottom: '8px' }}>{m.label}</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px', color: m.color || 'var(--text)' }}>{m.value || '—'}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="label-xs" style={{ marginBottom: '10px' }}>📋 Resumen general</div>
        <div style={{ fontSize: '14px', color: 'var(--text2)', lineHeight: '1.7', fontFamily: 'DM Sans, sans-serif' }}>{result.resumen_general}</div>
        {result.activo_destacado?.razon && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '8px' }}>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--violet-light)' }}>{result.activo_destacado.ticker}</span>
            <span style={{ fontSize: '13px', color: 'var(--text2)', marginLeft: '8px' }}>{result.activo_destacado.razon}</span>
          </div>
        )}
      </div>

      {/* Análisis por empresa */}
{result.analisis_empresas?.length > 0 && (
  <div className="card" style={{ marginBottom: '16px' }}>
    <div className="label-xs" style={{ marginBottom: '16px' }}>🏢 Análisis por empresa</div>
    {result.analisis_empresas.map((e: any, i: number) => (
      <div key={e.ticker} style={{ marginBottom: i < result.analisis_empresas.length-1 ? '16px' : '0', paddingBottom: i < result.analisis_empresas.length-1 ? '16px' : '0', borderBottom: i < result.analisis_empresas.length-1 ? '1px solid var(--border)' : 'none' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: COLORS[items.findIndex(t => t.ticker === e.ticker) % COLORS.length], marginBottom: '6px' }}>{e.ticker}</div>
        {e.descripcion && <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif', marginBottom: '6px' }}>{e.descripcion}</div>}
        {e.drivers && <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif', marginBottom: '4px' }}><span style={{ color: 'var(--amber)', fontWeight: 600 }}>Drivers: </span>{e.drivers}</div>}
        {e.tesis && <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}><span style={{ color: 'var(--violet-light)', fontWeight: 600 }}>Tesis: </span>{e.tesis}</div>}
      </div>
    ))}
  </div>
)}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '12px' }}>💡 Insights clave</div>
          {result.insights?.map((ins: string, i: number) => (
            <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px', color: 'var(--violet-light)', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>{i+1}</div>
              <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: '1.6', fontFamily: 'DM Sans, sans-serif' }}>{ins}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '12px' }}>🏆 Ranking</div>
          {result.ranking?.map((item: any, i: number) => (
            <div key={item.ticker} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', padding: '10px', background: 'var(--surface2)', borderRadius: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: i===0?'rgba(34,197,94,0.2)':i===1?'rgba(245,158,11,0.2)':'rgba(148,163,184,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: i===0?'var(--green)':i===1?'var(--amber)':'var(--muted2)', flexShrink: 0 }}>{i+1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{item.ticker}</div>
                <div style={{ fontSize: '11px', color: EC[item.etiqueta] || 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>{item.etiqueta}</div>
              </div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', fontWeight: 700, color: i===0?'var(--green)':'var(--text2)' }}>{item.puntos}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={() => { setResult(null); setError(null); }} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <RefreshCw size={13} /> Regenerar análisis
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'precios' as Tab,       label: 'Precios',       icon: '📈' },
  { key: 'fundamentales' as Tab, label: 'Fundamentales', icon: '📊' },
  { key: 'correlacion' as Tab,   label: 'Correlación',   icon: '🔗' },
  { key: 'graficos' as Tab,      label: 'Gráficos',      icon: '📉' },
  { key: 'analistas' as Tab,     label: 'Analistas',     icon: '🎯' },
  { key: 'ia' as Tab,            label: 'Resumen IA',    icon: '🤖' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('precios');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [items, setItems] = useState<TickerItem[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      try {
        const tickers: string[] = JSON.parse(saved);
        tickers.forEach(t => addTicker(t, true));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (items.length > 0) {
      localStorage.setItem(LS_KEY, JSON.stringify(items.map(t => t.ticker)));
    }
  }, [items.map(t => t.ticker).join(',')]);

  useEffect(() => {
    if (['graficos','correlacion','precios'].includes(tab) && !histLoaded) {
      setHistLoaded(true);
      items.forEach(t => {
        if (!t.historico && !t.loadingHistory) {
          cargarHist(t.ticker, t.usTicker, t.sufixFundamentals);
        }
      });
    }
  }, [tab]);

  async function fetchBasico(ticker: string): Promise<Partial<TickerItem>> {
    try {
      const res = await fetch(`/api/buscar?ticker=${ticker}`);
      const data = await res.json();
      if (data.error) return {};
      const precio = data.tipo === 'cedear' ? data.precio?.valor : (data.precio?.valor ?? data.precio);
      const variacion = data.tipo === 'cedear' ? data.precio?.variacion : data.variacion;
      return {
        nombre: data.nombre || data.spec?.nombre || ticker,
        tipo: data.tipo || 'renta_variable',
        moneda: data.tipo === 'cedear' ? (data.precio?.moneda || 'ARS') : (data.monedaLabel || 'USD'),
        precio: typeof precio === 'number' ? precio : null,
        variacion: typeof variacion === 'number' ? variacion : null,
        usTicker: data.usTicker || ticker,
        sufixFundamentals: data.sufixFundamentals || '',
        marketCap: data.marketCap ?? null, per: data.per ?? null,
        eps: data.eps ?? null, beta: data.beta ?? null,
        maximo52: data.maximo52 ?? null, minimo52: data.minimo52 ?? null,
        strongBuy: data.strongBuy ?? 0, buy: data.buy ?? 0,
        hold: data.hold ?? 0, sell: data.sell ?? 0, strongSell: data.strongSell ?? 0,
        numAnalistas: data.numAnalistas ?? null,
      };
    } catch { return {}; }
  }

  async function cargarHist(ticker: string, usTicker: string, suffix: string) {
    setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingHistory: true } : t));
    try {
      const res = await fetch(`/api/historico?ticker=${usTicker}&suffix=${encodeURIComponent(suffix)}&range=1y&interval=1d`);
      const data = await res.json();
      if (data.historico?.length > 0) {
        const h: Hist[] = data.historico;
        setItems(prev => prev.map(t => t.ticker === ticker ? {
          ...t, historico: h, loadingHistory: false,
          varMensual: varPeriodo(h, 30), varAnual: varPeriodo(h, 365), volatilidad: volatilidad(h),
        } : t));
      } else {
        setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingHistory: false } : t));
      }
    } catch {
      setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingHistory: false } : t));
    }
  }

  async function addTicker(rawTicker: string, silent = false) {
    const ticker = rawTicker.toUpperCase().trim();
    if (!ticker || items.some(t => t.ticker === ticker)) return;

    const base: TickerItem = {
      ticker, nombre: null, tipo: 'renta_variable', moneda: 'USD',
      precio: null, variacion: null, usTicker: ticker, sufixFundamentals: '',
      marketCap: null, per: null, eps: null, beta: null, maximo52: null, minimo52: null,
      strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, numAnalistas: null,
      historico: null, varMensual: null, varAnual: null, volatilidad: null,
      loading: true, loadingFunds: false, loadingHistory: false,
    };

    setItems(prev => [...prev, base]);
    if (!silent) setQuery('');

    const basicData = await fetchBasico(ticker);
    setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, ...basicData, loading: false } : t));

    const hasFunds = basicData.marketCap != null || basicData.per != null;
    if (!hasFunds && basicData.usTicker) {
      setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingFunds: true } : t));
      try {
        const res = await fetch(`/api/fundamentals?ticker=${basicData.usTicker}&suffix=${encodeURIComponent(basicData.sufixFundamentals || '')}`);
        const funds = await res.json();
        if (!funds.error) setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, ...funds, loadingFunds: false } : t));
        else setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingFunds: false } : t));
      } catch { setItems(prev => prev.map(t => t.ticker === ticker ? { ...t, loadingFunds: false } : t)); }
    }

    if (['graficos','correlacion','precios'].includes(tab) || histLoaded) {
      await cargarHist(ticker, basicData.usTicker || ticker, basicData.sufixFundamentals || '');
    }
  }

  function removeTicker(ticker: string) {
    const next = items.filter(t => t.ticker !== ticker);
    setItems(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next.map(t => t.ticker)));
  }

  async function refreshAll() {
    for (const t of items) {
      const data = await fetchBasico(t.ticker);
      setItems(prev => prev.map(item => item.ticker === t.ticker ? { ...item, ...data } : item));
    }
  }

  const handleSearch = async () => {
    if (!query.trim() || adding) return;
    setAdding(true);
    await addTicker(query);
    setAdding(false);
  };

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Dashboard</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>Análisis comparativo de mercado</div>
        </div>
        {items.length > 0 && (
          <button onClick={refreshAll} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
            <RefreshCw size={14} /> Actualizar
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: items.length > 0 ? '16px' : '0' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="input-field" style={{ paddingLeft: '36px' }}
              placeholder="Agregá un ticker: AAPL · NVDA · GD35 · GGAL · GOOGLD..."
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          </div>
          <button className="btn-primary" onClick={handleSearch} disabled={adding || !query.trim()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> {adding ? 'Agregando...' : 'Añadir'}
          </button>
        </div>
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {items.map((t, i) => (
              <div key={t.ticker} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: `${COLORS[i%COLORS.length]}15`, border: `1px solid ${COLORS[i%COLORS.length]}40`, borderRadius: '20px', padding: '4px 10px 4px 8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS[i%COLORS.length] }} />
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: COLORS[i%COLORS.length] }}>{t.ticker}</span>
                {t.loading && <span style={{ fontSize: '10px', color: 'var(--muted)' }}>...</span>}
                <button onClick={() => removeTicker(t.ticker)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--muted)', marginLeft: '2px' }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>📊</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>Agregá tickers para empezar</div>
          <div style={{ fontSize: '13px', color: 'var(--muted2)', maxWidth: '400px', margin: '0 auto' }}>
            Buscá cualquier activo: acciones US, CEDEARs, acciones argentinas o bonos. Podés comparar hasta 10 activos simultáneamente.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '12px', padding: '4px', overflowX: 'auto' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tab===t.key?'var(--violet)':'transparent', color: tab===t.key?'#fff':'var(--muted2)', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
          {tab === 'precios'       && <TabPrecios items={items} onSelect={ticker => router.push(`/dashboard/${ticker}`)} />}
          {tab === 'fundamentales' && <TabFundamentales items={items} />}
          {tab === 'correlacion'   && <TabCorrelacion items={items} />}
          {tab === 'graficos'      && <TabGraficos items={items} />}
          {tab === 'analistas'     && <TabAnalistas items={items} />}
          {tab === 'ia'            && <TabIA items={items} />}
        </>
      )}
    </div>
  );
}

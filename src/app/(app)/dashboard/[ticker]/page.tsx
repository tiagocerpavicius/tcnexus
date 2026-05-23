'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { PieChart, Pie, Cell } from 'recharts';

const fmtUSD = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtM   = (n: number | null) => { if (n == null) return '—'; if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(2)+'T'; if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2)+'B'; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M'; return n.toLocaleString(); };
const fmtNum = (n: number | null) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

interface Hist { fecha: string; cierre: number; }

function StatBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px' }}>
      <div className="label-xs" style={{ marginBottom: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: color || 'var(--text)', fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function GraficoHistorico({ ticker, usTicker, suffix }: { ticker: string; usTicker: string; suffix: string }) {
  const [rango, setRango] = useState<'7d'|'30d'|'3m'|'ytd'|'1y'>('1y');
  const [historico, setHistorico] = useState<Hist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/historico?ticker=${usTicker}&suffix=${encodeURIComponent(suffix)}&range=1y&interval=1d`)
      .then(r => r.json())
      .then(data => { if (data.historico) setHistorico(data.historico); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [usTicker, suffix]);

  function filtrar(h: Hist[]): Hist[] {
    if (rango === 'ytd') { const ini = new Date(new Date().getFullYear(),0,1).toISOString().split('T')[0]; return h.filter(d => d.fecha >= ini); }
    const dias: Record<string,number> = {'7d':7,'30d':30,'3m':90,'1y':365};
    const corte = new Date(); corte.setDate(corte.getDate()-dias[rango]);
    return h.filter(d => new Date(d.fecha) >= corte);
  }

  const data = filtrar(historico);
  const step = Math.max(1, Math.floor(data.length/200));
  const sampled = data.filter((_,i) => i%step===0 || i===data.length-1);

  const primero = data[0]?.cierre;
  const ultimo  = data[data.length-1]?.cierre;
  const varTotal = primero && ultimo ? +((ultimo-primero)/primero*100).toFixed(2) : null;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="label-xs" style={{ marginBottom: '4px' }}>📉 Rendimiento Histórico</div>
          {varTotal != null && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: colorV(varTotal) }}>{fmtPct(varTotal)} en el período</div>}
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--surface2)', borderRadius: '8px', padding: '4px' }}>
          {(['7d','30d','3m','ytd','1y'] as const).map(r => (
            <button key={r} onClick={() => setRango(r)} style={{ background: rango===r?'var(--violet)':'transparent', color: rango===r?'#fff':'var(--muted2)', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontFamily: 'Syne, sans-serif', fontWeight: 600, transition: 'all 0.15s' }}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando...</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={sampled} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="fecha" tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
              tickFormatter={v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth()+1}/${String(d.getFullYear()).slice(-2)}`; }}
              interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}
              tickFormatter={v => fmtUSD(v)} width={70} domain={['auto','auto']} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}
              formatter={(v: number) => [fmtUSD(v), ticker]}
              labelFormatter={v => new Date(v).toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' })}
            />
            <Line type="monotone" dataKey="cierre" stroke="#7c3aed" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function GraficoAnalistas({ strongBuy, buy, hold, sell, strongSell, numAnalistas, precio, precioObjetivo }: {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
  numAnalistas: number | null; precio: number | null; precioObjetivo: number | null;
}) {
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total === 0) return null;

  const segs = [
    { name: 'Compra Fuerte', value: strongBuy, color: '#22c55e' },
    { name: 'Compra',        value: buy,       color: '#86efac' },
    { name: 'Mantener',      value: hold,      color: '#f59e0b' },
    { name: 'Venta',         value: sell,      color: '#f87171' },
    { name: 'Venta Fuerte',  value: strongSell,color: '#ef4444' },
  ].filter(s => s.value > 0);

  const buyT = strongBuy + buy, sellT = sell + strongSell;
  let cons = 'Mantener', consC = '#f59e0b';
  if (buyT > hold && buyT > sellT) { cons = strongBuy >= buy ? 'Compra Fuerte' : 'Compra'; consC = '#22c55e'; }
  else if (sellT > hold && sellT > buyT) { cons = strongSell >= sell ? 'Venta Fuerte' : 'Venta'; consC = '#ef4444'; }

  return (
    <div className="card">
      <div className="label-xs" style={{ marginBottom: '16px' }}>🎯 Recomendaciones de analistas {numAnalistas ? `(${numAnalistas})` : ''}</div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PieChart width={130} height={130}>
            <Pie data={segs} cx={60} cy={60} innerRadius={38} outerRadius={60} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
              {segs.map((s, i) => <Cell key={i} fill={s.color} stroke="transparent" />)}
            </Pie>
            <Tooltip
              formatter={(v: number) => [`${v} (${((v/total)*100).toFixed(0)}%)`, '']}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}
            />
          </PieChart>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', fontWeight: 700, color: consC, lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '2px' }}>total</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', color: consC }}>{cons}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>Consenso de analistas</div>
          </div>
          {segs.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1 }}>{s.name}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text)' }}>{s.value}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)', minWidth: '34px', textAlign: 'right' }}>{((s.value/total)*100).toFixed(0)}%</span>
            </div>
          ))}
          {precioObjetivo != null && precio != null && (
            <div style={{ marginTop: '10px', padding: '8px 10px', background: 'var(--surface2)', borderRadius: '8px' }}>
              <div className="label-xs" style={{ marginBottom: '4px' }}>Precio objetivo</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>{fmtUSD(precioObjetivo)}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: precioObjetivo > precio ? 'var(--green)' : 'var(--red)' }}>
                  {precioObjetivo > precio ? '+' : ''}{(((precioObjetivo-precio)/precio)*100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TickerPage() {
  const router = useRouter();
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase();

  const [data, setData] = useState<any>(null);
  const [funds, setFunds] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);

    // Fetch básico via buscar
    fetch(`/api/buscar?ticker=${ticker}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setData(d);
          // Si no tiene fundamentals, cargarlos lazy
          const hasFunds = d.marketCap != null || d.per != null;
          if (!hasFunds && d.usTicker) {
            fetch(`/api/fundamentals?ticker=${d.usTicker}&suffix=${encodeURIComponent(d.sufixFundamentals || '')}`)
              .then(r => r.json())
              .then(f => { if (!f.error) setFunds(f); })
              .catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) return (
    <div style={{ maxWidth: '900px' }}>
      <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px', marginBottom: '24px', padding: 0 }}>
        <ArrowLeft size={16} /> Volver al Dashboard
      </button>
      <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Cargando {ticker}...</div>
    </div>
  );

  if (!data || data.error) return (
    <div style={{ maxWidth: '900px' }}>
      <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px', marginBottom: '24px', padding: 0 }}>
        <ArrowLeft size={16} /> Volver al Dashboard
      </button>
      <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
        <div style={{ color: 'var(--red)', fontSize: '14px' }}>No se encontraron datos para {ticker}</div>
      </div>
    </div>
  );

  // Extraer datos según tipo
  const esRF    = data.tipo === 'renta_fija';
  const esCedear = data.tipo === 'cedear';
  const precio   = esCedear ? data.precio?.valor : (data.precio?.valor ?? data.precio);
  const variacion = esCedear ? data.precio?.variacion : data.variacion;
  const nombre   = data.nombre || data.spec?.nombre || ticker;
  const moneda   = esCedear ? (data.precio?.moneda || 'ARS') : (data.monedaLabel || 'USD');
  const usTicker = data.usTicker || ticker;
  const suffix   = data.sufixFundamentals || '';

  const marketCap = funds?.marketCap ?? data.marketCap ?? null;
  const per       = funds?.per       ?? data.per       ?? null;
  const eps       = funds?.eps       ?? data.eps       ?? null;
  const beta      = funds?.beta      ?? data.beta      ?? null;
  const max52     = funds?.maximo52  ?? data.maximo52  ?? null;
  const min52     = funds?.minimo52  ?? data.minimo52  ?? null;
  const strongBuy = funds?.strongBuy ?? data.strongBuy ?? 0;
  const buy       = funds?.buy       ?? data.buy       ?? 0;
  const hold      = funds?.hold      ?? data.hold      ?? 0;
  const sell      = funds?.sell      ?? data.sell      ?? 0;
  const strongSell = funds?.strongSell ?? data.strongSell ?? 0;
  const numAnal   = funds?.numAnalistas ?? data.numAnalistas ?? null;
  const precioObj = funds?.precioObjetivo ?? data.precioObjetivo ?? null;

  const fmtPrecio = (n: number | null) => moneda === 'ARS' ? fmtARS(n) : fmtUSD(n);

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Volver */}
      <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '14px', marginBottom: '24px', padding: 0, transition: 'color 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--violet-light)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted2)')}>
        <ArrowLeft size={16} /> Volver al Dashboard
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '28px', color: 'var(--text)', margin: 0 }}>{ticker}</h1>
            {esCedear && <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)', color: 'var(--violet-light)', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>CEDEAR</span>}
            {esRF && <span style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#60a5fa', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>Renta Fija</span>}
            {moneda && <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>{moneda}</span>}
          </div>
          {nombre && nombre !== ticker && <div style={{ fontSize: '14px', color: 'var(--text2)', fontFamily: 'DM Sans, sans-serif' }}>{nombre}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '36px', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmtPrecio(typeof precio === 'number' ? precio : null)}</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: colorV(typeof variacion === 'number' ? variacion : null), marginTop: '4px' }}>{fmtPct(typeof variacion === 'number' ? variacion : null)}</div>
        </div>
      </div>

      {/* Métricas clave */}
      {!esRF && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <StatBox label="Market Cap" value={fmtM(marketCap)} />
          <StatBox label="P/E Ratio"  value={fmtNum(per)} />
          <StatBox label="EPS"        value={eps != null ? '$'+Number(eps).toFixed(2) : '—'} />
          <StatBox label="Beta"       value={fmtNum(beta)} />
        </div>
      )}

      {/* Rango 52 semanas */}
      {max52 != null && min52 != null && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div><div className="label-xs" style={{ marginBottom: '4px' }}>Mínimo 52 sem.</div><div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>{fmtUSD(min52)}</div></div>
            <div style={{ textAlign: 'right' }}><div className="label-xs" style={{ marginBottom: '4px' }}>Máximo 52 sem.</div><div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>{fmtUSD(max52)}</div></div>
          </div>
          {typeof precio === 'number' && (
            <div style={{ position: 'relative', height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
              <div style={{ height: '100%', borderRadius: '3px', background: 'linear-gradient(to right, var(--red), var(--amber), var(--green))' }} />
              <div style={{ position: 'absolute', width: '12px', height: '12px', borderRadius: '50%', background: 'var(--violet)', top: '-3px', transform: 'translateX(-50%)', left: `${Math.max(0, Math.min(100, ((precio-min52)/(max52-min52))*100))}%`, border: '2px solid var(--bg)' }} />
            </div>
          )}
        </div>
      )}

      {/* Gráfico histórico — solo para RV y CEDEARs */}
      {!esRF && (
        <div style={{ marginBottom: '16px' }}>
          <GraficoHistorico ticker={ticker} usTicker={usTicker} suffix={suffix} />
        </div>
      )}

      {/* Analistas */}
      {!esRF && (strongBuy + buy + hold + sell + strongSell) > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <GraficoAnalistas
            strongBuy={strongBuy} buy={buy} hold={hold} sell={sell} strongSell={strongSell}
            numAnalistas={numAnal} precio={typeof precio === 'number' ? precio : null}
            precioObjetivo={precioObj}
          />
        </div>
      )}

      {/* Para renta fija — mostrar analytics */}
      {esRF && data.analytics && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="label-xs" style={{ marginBottom: '12px' }}>📊 Analytics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            <StatBox label="TIR (TEA)" value={data.analytics.tir != null ? `${data.analytics.tir.toFixed(2)}%` : '—'} color="var(--green)" />
            <StatBox label="Duration Mod." value={data.analytics.durationMod != null ? `${data.analytics.durationMod.toFixed(2)} años` : '—'} />
            <StatBox label="Paridad" value={data.analytics.paridad != null ? `${data.analytics.paridad.toFixed(2)}%` : '—'} />
            <StatBox label="PVBP" value={data.analytics.pvbp != null ? `$${data.analytics.pvbp.toFixed(4)}` : '—'} sub="por 1bp" />
          </div>
          {data.analytics.proximoPago && (
            <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="label-xs" style={{ color: 'var(--green)', marginBottom: '4px' }}>📅 Próximo pago</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>{new Date(data.analytics.proximoPago.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' })}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: 'var(--green)', fontWeight: 600 }}>${data.analytics.proximoPago.total.toFixed(4)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info adicional */}
      {data.spec && (
        <div className="card">
          <div className="label-xs" style={{ marginBottom: '12px' }}>ℹ️ Información del activo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {data.spec.vencimiento && <StatBox label="Vencimiento" value={new Date(data.spec.vencimiento).toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' })} />}
            {data.spec.tasaCupon   && <StatBox label="Tasa cupón" value={`${data.spec.tasaCupon}%`} />}
            {data.spec.ley         && <StatBox label="Ley" value={data.spec.ley === 'nueva_york' ? 'Nueva York' : 'Argentina'} />}
            {data.spec.sector      && <StatBox label="Sector" value={data.spec.sector} />}
          </div>
        </div>
      )}
    </div>
  );
}

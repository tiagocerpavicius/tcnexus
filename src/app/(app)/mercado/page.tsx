'use client';
import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Search, X, ChevronDown, ChevronUp, Calculator } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Cotizacion, DolarRate } from '@/lib/types';

const DOLAR_NOMBRES: Record<string, string> = { oficial: 'Oficial', blue: 'Blue', bolsa: 'MEP', contadoconliqui: 'CCL' };
const RECOM: Record<string, { label: string; color: string }> = {
  strong_buy: { label: 'Compra Fuerte', color: 'var(--green)' },
  buy:        { label: 'Compra',        color: '#34d399' },
  hold:       { label: 'Mantener',      color: 'var(--amber)' },
  sell:       { label: 'Venta',         color: '#f87171' },
  strong_sell:{ label: 'Venta Fuerte',  color: 'var(--red)' },
};

const fmtUSD = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtARS = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtM   = (n: number | null) => { if (n == null) return '—'; if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(2)+'T'; if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2)+'B'; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M'; return n.toLocaleString('es-AR'); };
const fmtNum = (n: number | null) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const colorV = (n: number | null) => n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

function StatBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px' }}>
      <div className="label-xs" style={{ marginBottom: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: color || 'var(--text)', fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}40`, color, borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function AnalystChart({ strongBuy, buy, hold, sell, strongSell, precioObjetivo, precio, numAnalistas }: {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
  precioObjetivo?: number | null; precio?: number | null; numAnalistas?: number | null;
}) {
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total === 0) return null;
  const segments = [
    { name: 'Compra Fuerte', value: strongBuy,  color: '#22c55e' },
    { name: 'Compra',        value: buy,         color: '#86efac' },
    { name: 'Mantener',      value: hold,        color: '#f59e0b' },
    { name: 'Venta',         value: sell,        color: '#f87171' },
    { name: 'Venta Fuerte',  value: strongSell,  color: '#ef4444' },
  ].filter(d => d.value > 0);
  const buyTotal = strongBuy + buy, sellTotal = sell + strongSell;
  let consensoLabel = 'Mantener', consensoColor = '#f59e0b';
  if (buyTotal > hold && buyTotal > sellTotal) { consensoLabel = strongBuy >= buy ? 'Compra Fuerte' : 'Compra'; consensoColor = strongBuy >= buy ? '#22c55e' : '#86efac'; }
  else if (sellTotal > hold && sellTotal > buyTotal) { consensoLabel = strongSell >= sell ? 'Venta Fuerte' : 'Venta'; consensoColor = strongSell >= sell ? '#ef4444' : '#f87171'; }

  return (
    <div style={{ background: 'var(--surface2)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
      <div className="label-xs" style={{ marginBottom: '16px' }}>🎯 Recomendaciones de analistas {numAnalistas ? `(${numAnalistas})` : ''}</div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PieChart width={130} height={130}>
            <Pie data={segments} cx={60} cy={60} innerRadius={38} outerRadius={60} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
              {segments.map((s, i) => <Cell key={i} fill={s.color} stroke="transparent" />)}
            </Pie>
            <Tooltip formatter={(value: number) => [`${value} (${((value/total)*100).toFixed(0)}%)`, '']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontFamily: 'DM Mono, monospace' }} />
          </PieChart>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', fontWeight: 700, color: consensoColor, lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '2px' }}>total</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', color: consensoColor }}>{consensoLabel}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>Consenso de analistas</div>
          </div>
          {segments.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1 }}>{s.name}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text)', minWidth: '20px', textAlign: 'right' }}>{s.value}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)', minWidth: '34px', textAlign: 'right' }}>{((s.value/total)*100).toFixed(0)}%</span>
            </div>
          ))}
          {precioObjetivo != null && precio != null && (
            <div style={{ marginTop: '10px', padding: '8px 10px', background: 'var(--surface)', borderRadius: '8px' }}>
              <div className="label-xs" style={{ marginBottom: '4px' }}>Precio objetivo promedio</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>${precioObjetivo.toFixed(2)}</span>
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

function useFundamentals(usTicker: string | null, sufixFundamentals: string, hasFundamentals = false) {
  const [funds, setFunds] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!usTicker || hasFundamentals) return;
    setLoading(true);
    fetch(`/api/fundamentals?ticker=${encodeURIComponent(usTicker)}&suffix=${encodeURIComponent(sufixFundamentals)}`)
      .then(r => r.json()).then(data => { if (!data.error) setFunds(data); }).catch(() => {}).finally(() => setLoading(false));
  }, [usTicker, sufixFundamentals, hasFundamentals]);
  return { funds, loading };
}

function SearchResultRV({ r }: { r: any }) {
  const isMobile = useIsMobile();
  const hasFundamentals = r.marketCap != null || r.per != null || r.beta != null;
  const { funds, loading } = useFundamentals(hasFundamentals ? null : (r.usTicker || null), r.sufixFundamentals || '', hasFundamentals);
  const recom = r.recomendacion ? RECOM[r.recomendacion] : null;
  const marketCap = funds?.marketCap ?? r.marketCap ?? null;
  const per = funds?.per ?? r.per ?? null;
  const eps = funds?.eps ?? r.eps ?? null;
  const beta = funds?.beta ?? r.beta ?? null;
  const maximo52 = funds?.maximo52 ?? r.maximo52 ?? null;
  const minimo52 = funds?.minimo52 ?? r.minimo52 ?? null;
  const strongBuy = funds?.strongBuy ?? r.strongBuy ?? 0;
  const buy = funds?.buy ?? r.buy ?? 0;
  const hold = funds?.hold ?? r.hold ?? 0;
  const sell = funds?.sell ?? r.sell ?? 0;
  const strongSell = funds?.strongSell ?? r.strongSell ?? 0;
  const numAnalistas = funds?.numAnalistas ?? r.numAnalistas ?? null;
  const precioObjetivo = funds?.precioObjetivo ?? r.precioObjetivo ?? null;
  const hasAnalistas = (strongBuy + buy + hold + sell + strongSell) > 0;
  const grid4 = isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)';
  const grid2 = isMobile ? '1fr' : '1fr 1fr';

  return (
    <div className="card fade-in" style={{ borderColor: 'rgba(124,58,237,0.4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: isMobile ? '18px' : '22px', color: 'var(--text)' }}>{r.ticker}</span>
            {r.nombre && r.nombre !== r.ticker && <span style={{ fontSize: '14px', color: 'var(--text2)' }}>{r.nombre}</span>}
            {r.exchange && <Badge label={r.exchange} color="var(--violet-light)" />}
            {r.moneda && <Badge label={r.moneda} color="var(--muted2)" />}
          </div>
          {r.fechaHora && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Último: {new Date(r.fechaHora).toLocaleString('es-AR')}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '24px' : '32px', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmtUSD(r.precio)}</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: colorV(r.variacion), marginTop: '4px' }}>
            {r.cambio != null ? (r.cambio > 0 ? '+' : '') + r.cambio.toFixed(2) : ''} ({fmtPct(r.variacion)})
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface2)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px', marginBottom: '10px' }}>
          <div><div className="label-xs" style={{ marginBottom: '6px' }}>Rango del día</div><div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>{fmtUSD(r.minimo)} — {fmtUSD(r.maximo)}</div></div>
          <div><div className="label-xs" style={{ marginBottom: '6px' }}>Rango 52 semanas</div><div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>{fmtUSD(minimo52)} — {fmtUSD(maximo52)}</div></div>
        </div>
        {minimo52 != null && maximo52 != null && r.precio != null && (
          <div style={{ position: 'relative', height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
            <div style={{ height: '100%', borderRadius: '2px', background: 'linear-gradient(to right, var(--red), var(--amber), var(--green))' }} />
            <div style={{ position: 'absolute', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--violet)', top: '-3px', transform: 'translateX(-50%)', left: `${Math.max(0, Math.min(100, ((r.precio-minimo52)/(maximo52-minimo52))*100))}%` }} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '16px' }}>
        <StatBox label="Apertura" value={fmtUSD(r.apertura)} />
        <StatBox label="Cierre ant." value={fmtUSD(r.cierreAnterior)} />
        <StatBox label="Volumen" value={fmtM(r.volumen)} />
        <StatBox label="Vol. prom." value={fmtM(r.volumenPromedio)} />
      </div>

      {loading && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginBottom: '12px' }}>Cargando fundamentals...</div>}

      {(marketCap != null || per != null) && (
        <>
          <div className="label-xs" style={{ marginBottom: '10px' }}>📊 Fundamentals</div>
          <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '16px' }}>
            {marketCap != null && <StatBox label="Market Cap" value={fmtM(marketCap)} />}
            {per != null && <StatBox label="P/E Trailing" value={fmtNum(per)} />}
            {r.perFwd != null && <StatBox label="P/E Forward" value={fmtNum(r.perFwd)} />}
            {eps != null && <StatBox label="EPS" value={fmtUSD(eps)} />}
            {beta != null && <StatBox label="Beta" value={fmtNum(beta)} />}
            {r.valorLibro != null && <StatBox label="Valor libro" value={fmtUSD(r.valorLibro)} />}
            {r.margenNeto != null && <StatBox label="Margen neto" value={fmtPct(r.margenNeto)} />}
            {r.roe != null && <StatBox label="ROE" value={fmtPct(r.roe)} />}
          </div>
        </>
      )}

      {hasAnalistas && <AnalystChart strongBuy={strongBuy} buy={buy} hold={hold} sell={sell} strongSell={strongSell} precioObjetivo={precioObjetivo} precio={r.precio} numAnalistas={numAnalistas} />}

      <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
        {(r.dividendo != null || r.rendDividendo != null) && (
          <div style={{ background: 'var(--surface2)', borderRadius: '10px', padding: '14px' }}>
            <div className="label-xs" style={{ marginBottom: '10px' }}>💰 Dividendo</div>
            {r.dividendo != null && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{ fontSize: '13px', color: 'var(--text2)' }}>Anual</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>{fmtUSD(r.dividendo)}</span></div>}
            {r.rendDividendo != null && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '13px', color: 'var(--text2)' }}>Rendimiento</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--green)' }}>{fmtPct(r.rendDividendo)}</span></div>}
            {r.fechaExDividendo && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}><span style={{ fontSize: '13px', color: 'var(--text2)' }}>Ex-dividendo</span><span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text2)' }}>{r.fechaExDividendo}</span></div>}
          </div>
        )}
        {recom && (
          <div style={{ background: 'var(--surface2)', borderRadius: '10px', padding: '14px' }}>
            <div className="label-xs" style={{ marginBottom: '10px' }}>🎯 Consenso {r.numAnalistas ? `(${r.numAnalistas})` : ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: 'var(--text2)' }}>Consenso</span>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: recom.color }}>{recom.label}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultCedear({ r }: { r: any }) {
  const isMobile = useIsMobile();
  const hasFundamentals = r.marketCap != null || r.per != null || r.beta != null;
  const { funds, loading } = useFundamentals(hasFundamentals ? null : (r.usTicker || null), r.sufixFundamentals ?? '', hasFundamentals);
  const precio = r.precio || {};
  const esUSD = precio.moneda === 'USD';
  const fmtPrecio = (n: number | null) => n == null ? '—' : esUSD ? fmtUSD(n) : fmtARS(n);
  const marketCap = funds?.marketCap ?? r.marketCap ?? null;
  const per = funds?.per ?? r.per ?? null;
  const eps = funds?.eps ?? r.eps ?? null;
  const beta = funds?.beta ?? r.beta ?? null;
  const maximo52 = funds?.maximo52 ?? r.maximo52 ?? null;
  const minimo52 = funds?.minimo52 ?? r.minimo52 ?? null;
  const strongBuy = funds?.strongBuy ?? r.strongBuy ?? 0;
  const buy = funds?.buy ?? r.buy ?? 0;
  const hold = funds?.hold ?? r.hold ?? 0;
  const sell = funds?.sell ?? r.sell ?? 0;
  const strongSell = funds?.strongSell ?? r.strongSell ?? 0;
  const numAnalistas = funds?.numAnalistas ?? r.numAnalistas ?? null;
  const precioObjetivo = funds?.precioObjetivo ?? r.precioObjetivo ?? null;
  const hasAnalistas = (strongBuy + buy + hold + sell + strongSell) > 0;
  const grid4 = isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)';

  return (
    <div className="card fade-in" style={{ borderColor: 'rgba(124,58,237,0.4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: isMobile ? '18px' : '22px', color: 'var(--text)' }}>{r.ticker}</span>
            <Badge label="CEDEAR" color="var(--violet-light)" />
            <Badge label={esUSD ? '💵 USD · Seg. D' : '🇦🇷 ARS · Seg. 48hs'} color={esUSD ? 'var(--blue)' : 'var(--green)'} />
            {r.fuente && <Badge label={r.fuente} color="var(--muted)" />}
          </div>
          {r.nombre && <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '2px' }}>{r.nombre}</div>}
          {precio.fechaHora && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Último: {new Date(precio.fechaHora).toLocaleString('es-AR')}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '24px' : '32px', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmtPrecio(precio.valor)}</div>
          {precio.variacion != null && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: colorV(precio.variacion), marginTop: '4px' }}>{fmtPct(precio.variacion)}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '16px' }}>
        <StatBox label="Apertura" value={fmtPrecio(precio.apertura ?? null)} />
        <StatBox label="Máximo" value={fmtPrecio(precio.maximo ?? null)} />
        <StatBox label="Mínimo" value={fmtPrecio(precio.minimo ?? null)} />
        <StatBox label="Cierre ant." value={fmtPrecio(precio.cierreAnterior ?? null)} />
      </div>

      {loading && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginBottom: '12px' }}>Cargando fundamentals...</div>}

      {(maximo52 != null || minimo52 != null) && (
        <div style={{ background: 'var(--surface2)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
          <div className="label-xs" style={{ marginBottom: '6px' }}>Rango 52 semanas (subyacente)</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)', marginBottom: '8px' }}>{fmtUSD(minimo52)} — {fmtUSD(maximo52)}</div>
          {minimo52 != null && maximo52 != null && precio.valor != null && (
            <div style={{ position: 'relative', height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
              <div style={{ height: '100%', borderRadius: '2px', background: 'linear-gradient(to right, var(--red), var(--amber), var(--green))' }} />
              <div style={{ position: 'absolute', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--violet)', top: '-3px', transform: 'translateX(-50%)', left: `${Math.max(0, Math.min(100, ((precio.valor-minimo52)/(maximo52-minimo52))*100))}%` }} />
            </div>
          )}
        </div>
      )}

      {(marketCap != null || per != null || beta != null) && (
        <>
          <div className="label-xs" style={{ marginBottom: '10px' }}>📊 Fundamentals (subyacente US)</div>
          <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '16px' }}>
            {marketCap != null && <StatBox label="Market Cap" value={fmtM(marketCap)} />}
            {per != null && <StatBox label="P/E" value={fmtNum(per)} />}
            {eps != null && <StatBox label="EPS" value={fmtUSD(eps)} />}
            {beta != null && <StatBox label="Beta" value={fmtNum(beta)} />}
          </div>
        </>
      )}

      {hasAnalistas && <AnalystChart strongBuy={strongBuy} buy={buy} hold={hold} sell={sell} strongSell={strongSell} precioObjetivo={precioObjetivo} precio={precio.valor} numAnalistas={numAnalistas} />}
    </div>
  );
}

function SearchResultRF({ r }: { r: any }) {
  const isMobile = useIsMobile();
  const [vnSim, setVnSim] = useState('10000');
  const [simResult, setSimResult] = useState<any>(null);
  const [showAllFlujos, setShowAllFlujos] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const [mep, setMep] = useState<number>(1430);
  const esUSD = r.monedaLabel === 'USD' || r.precio?.moneda === 'USD';
  const fmtPrecio = (n: number | null) => n == null ? '—' : esUSD ? fmtUSD(n) : fmtARS(n);
  const grid4 = isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)';
  const grid3 = isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';

  useEffect(() => {
    if (!esUSD) {
      fetch('/api/dolar').then(r => r.json()).then((data: any[]) => {
        const bolsa = Array.isArray(data) ? data.find(d => d.casa === 'bolsa') : null;
        if (bolsa?.venta) setMep(bolsa.venta);
      }).catch(() => {});
    }
  }, [esUSD]);

  const handleSimular = () => {
    if (!r.analytics?.flujos?.length) return;
    const vn = parseFloat(vnSim);
    if (isNaN(vn) || vn <= 0) return;
    const factor = vn / 100, convFactor = esUSD ? 1 : mep;
    const inversion = +((r.precio?.valor ?? 0) / 100 * vn).toFixed(2);
    const flujos = r.analytics.flujos.map((f: any, i: number) => ({
      ...f, n: i+1,
      interesT: +(f.interes*factor*convFactor).toFixed(2),
      amortT:   +(f.amortizacion*factor*convFactor).toFixed(2),
      totalT:   +(f.total*factor*convFactor).toFixed(2),
    }));
    const totalCobros = +flujos.reduce((s: number, f: any) => s+f.totalT, 0).toFixed(2);
    setSimResult({ vn, inversion, flujos, totalCobros, ganancia: +(totalCobros-inversion).toFixed(2) });
  };

  const precio = r.precio || {}, spec = r.spec || {}, analytics = r.analytics;

  return (
    <div className="card fade-in" style={{ borderColor: esUSD ? 'rgba(59,130,246,0.35)' : 'rgba(16,185,129,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: isMobile ? '18px' : '22px', color: 'var(--text)' }}>{r.ticker}</span>
            <Badge label={esUSD ? '💵 USD · Seg. D' : '🇦🇷 ARS · Seg. 48hs'} color={esUSD ? 'var(--blue)' : 'var(--green)'} />
            {spec.ley && <Badge label={spec.ley === 'nueva_york' ? 'NY Law' : 'Ley Arg.'} color="var(--violet-light)" />}
            {spec.sector && <Badge label={spec.sector} color="var(--muted2)" />}
            {r.fuente && <Badge label={r.fuente} color="var(--muted)" />}
          </div>
          {spec.nombre && <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '2px' }}>{spec.nombre}</div>}
          {spec.cuponDesc && <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Cupón: {spec.cuponTexto || spec.cuponDesc}{spec.laminaMinima ? ` · Lámina mín. ${spec.laminaMinima}` : ''}</div>}
          {precio.fechaHora && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginTop: '2px' }}>Último: {new Date(precio.fechaHora).toLocaleString('es-AR')} · {precio.fuente}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '24px' : '32px', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmtPrecio(precio.valor)}</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px', color: colorV(precio.variacion), marginTop: '4px' }}>{fmtPct(precio.variacion)}</div>
          {spec.vencimiento && <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace', marginTop: '4px' }}>Vence {new Date(spec.vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
        </div>
      </div>

      {analytics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '10px' }}>
            <StatBox label="TIR (TEA)"    value={analytics.tir != null ? `${analytics.tir.toFixed(2)}%` : '—'} color="var(--green)" />
            <StatBox label="Duration Mod." value={analytics.durationMod != null ? `${analytics.durationMod.toFixed(2)} años` : '—'} />
            <StatBox label="Paridad"      value={analytics.paridad != null ? `${analytics.paridad.toFixed(2)}%` : '—'} />
            <StatBox label="PVBP"         value={analytics.pvbp != null ? `$${analytics.pvbp.toFixed(4)}` : '—'} sub="por 1bp" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '16px' }}>
            <StatBox label="Precio Dirty"    value={analytics.precioDirty != null ? `$${analytics.precioDirty.toFixed(4)}` : '—'} />
            <StatBox label="Precio Clean"    value={analytics.precioClean != null ? `$${analytics.precioClean.toFixed(4)}` : '—'} />
            <StatBox label="Interés corrido" value={analytics.interesCorreido != null ? `$${analytics.interesCorreido.toFixed(4)}` : '—'} />
            <StatBox label="Tasa cupón"      value={spec.tasaCupon != null ? `${spec.tasaCupon}%` : '—'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: grid4, gap: '10px', marginBottom: '20px' }}>
            <StatBox label="Apertura"    value={fmtPrecio(precio.apertura)} />
            <StatBox label="Máximo"      value={fmtPrecio(precio.maximo)} />
            <StatBox label="Mínimo"      value={fmtPrecio(precio.minimo)} />
            <StatBox label="Cierre ant." value={fmtPrecio(precio.cierreAnterior)} />
          </div>

          {analytics.proximoPago && (
            <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div className="label-xs" style={{ color: 'var(--green)', marginBottom: '4px' }}>📅 Próximo pago</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>{new Date(analytics.proximoPago.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', color: 'var(--green)', fontWeight: 600 }}>${analytics.proximoPago.total.toFixed(4)}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'DM Mono, monospace' }}>Int: ${analytics.proximoPago.interes.toFixed(4)} · Amort: ${analytics.proximoPago.amortizacion.toFixed(4)}</div>
              </div>
            </div>
          )}

          {analytics.flujos?.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div className="label-xs">💵 Flujo de pagos ({analytics.cantFlujos} cuotas)</div>
                {analytics.flujos.length > 8 && (
                  <button onClick={() => setShowAllFlujos(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--violet-light)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                    {showAllFlujos ? <><ChevronUp size={14} /> Menos</> : <><ChevronDown size={14} /> Ver todos ({analytics.flujos.length})</>}
                  </button>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['#','Fecha','Interés','Amortiz.','Total'].map(h => (<th key={h} style={{ padding: '6px 10px', color: 'var(--muted2)', fontWeight: 400, textAlign: 'right' }}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllFlujos ? analytics.flujos : analytics.flujos.slice(0, 8)).map((f: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'rgba(255,255,255,0.01)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--muted)', textAlign: 'right' }}>{i+1}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text2)', textAlign: 'right', whiteSpace: 'nowrap' }}>{new Date(f.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--green)', textAlign: 'right' }}>{f.interes.toFixed(4)}</td>
                        <td style={{ padding: '7px 10px', color: f.amortizacion>0?'var(--amber)':'var(--muted)', textAlign: 'right' }}>{f.amortizacion.toFixed(4)}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>{f.total.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border2)' }}>
                      <td colSpan={2} />
                      <td style={{ padding: '8px 10px', color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>${analytics.flujos.reduce((s: number, f: any) => s+f.interes, 0).toFixed(4)}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--amber)', fontWeight: 700, textAlign: 'right' }}>${analytics.flujos.reduce((s: number, f: any) => s+f.amortizacion, 0).toFixed(4)}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--text)', fontWeight: 700, textAlign: 'right' }}>${analytics.flujos.reduce((s: number, f: any) => s+f.total, 0).toFixed(4)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '12px', padding: '16px' }}>
            <button onClick={() => setShowSim(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--violet-light)', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', width: '100%', padding: 0 }}>
              <Calculator size={16} /> Simulador de inversión
              {showSim ? <ChevronUp size={14} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={14} style={{ marginLeft: 'auto' }} />}
            </button>
            {showSim && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <div className="label-xs" style={{ marginBottom: '6px' }}>VN a comprar (USD){!esUSD && <span style={{ color: 'var(--muted)', marginLeft: '6px', fontWeight: 400 }}>· flujos en ARS (MEP ${mep.toLocaleString('es-AR')})</span>}</div>
                    <input className="input-field" type="number" value={vnSim} onChange={e => setVnSim(e.target.value)} placeholder="10000" min="100" step="100" />
                  </div>
                  <button className="btn-primary" onClick={handleSimular}>Calcular</button>
                </div>
                {simResult && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: grid3, gap: '10px', marginBottom: '16px' }}>
                      <StatBox label="VN Comprado" value={`USD ${simResult.vn.toLocaleString('es-AR')}`} />
                      <StatBox label={esUSD?'Inversión (USD)':'Inversión (ARS)'} value={fmtPrecio(simResult.inversion)} color="var(--amber)" />
                      <StatBox label={esUSD?'Total cobros (USD)':'Total cobros (ARS)'} value={fmtPrecio(simResult.totalCobros)} color="var(--green)" />
                      <StatBox label={esUSD?'Ganancia neta (USD)':'Ganancia neta (ARS)'} value={`${simResult.ganancia>=0?'+':''}${fmtPrecio(simResult.ganancia)}`} color={simResult.ganancia>=0?'var(--green)':'var(--red)'} />
                      <StatBox label="TIR (TEA)" value={analytics.tir!=null?`${analytics.tir.toFixed(2)}%`:'—'} color="var(--green)" />
                      <StatBox label="Cuotas" value={`${simResult.flujos.length} pagos`} />
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '280px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Mono, monospace', fontSize: '12px' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['#','Fecha','Interés','Amortiz.','Total'].map(h => (<th key={h} style={{ padding: '6px 10px', color: 'var(--muted2)', fontWeight: 400, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>))}
                          </tr>
                        </thead>
                        <tbody>
                          {simResult.flujos.map((f: any) => (
                            <tr key={f.n} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '6px 10px', color: 'var(--muted)', textAlign: 'right' }}>{f.n}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--text2)', textAlign: 'right', whiteSpace: 'nowrap' }}>{new Date(f.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--green)', textAlign: 'right' }}>${f.interesT.toFixed(2)}</td>
                              <td style={{ padding: '6px 10px', color: f.amortT>0?'var(--amber)':'var(--muted)', textAlign: 'right' }}>${f.amortT.toFixed(2)}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>${f.totalT.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid var(--border2)' }}>
                            <td colSpan={2} />
                            <td style={{ padding: '8px 10px', color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>${simResult.flujos.reduce((s: number, f: any) => s+f.interesT, 0).toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--amber)', fontWeight: 700, textAlign: 'right' }}>${simResult.flujos.reduce((s: number, f: any) => s+f.amortT, 0).toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)', fontWeight: 700, textAlign: 'right' }}>${simResult.totalCobros.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {!analytics && (
        <div style={{ marginTop: '12px', padding: '12px 16px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '8px' }}>
          <div style={{ fontSize: '13px', color: 'var(--amber)', fontFamily: 'Syne, sans-serif', fontWeight: 700, marginBottom: '4px' }}>Analytics no disponibles</div>
          <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>Mostrando datos básicos de IOL.</div>
        </div>
      )}
    </div>
  );
}

export default function MercadoPage() {
  const isMobile = useIsMobile();
  const [acciones, setAcciones] = useState<Cotizacion[]>([]);
  const [bonos, setBonos] = useState<Cotizacion[]>([]);
  const [cedears, setCedears] = useState<Cotizacion[]>([]);
  const [dolar, setDolar] = useState<DolarRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<any>(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [mRes, dRes] = await Promise.all([fetch('/api/mercado'), fetch('/api/dolar')]);
      const [m, d] = await Promise.all([mRes.json(), dRes.json()]);
      if (m.acciones) setAcciones(m.acciones);
      if (m.bonos)    setBonos(m.bonos);
      if (m.cedears)  setCedears(m.cedears);
      if (Array.isArray(d)) setDolar(d);
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    fetch('/api/fundamentals?ticker=AAPL&suffix=').catch(() => {});
  }, [fetchAll]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true); setResult(null);
    try {
      const res = await fetch(`/api/buscar?ticker=${query.trim().toUpperCase()}`);
      setResult(await res.json());
    } catch { setResult({ error: 'Error al buscar' }); }
    setSearching(false);
  };

  const hotMovers = [...acciones].filter(a => a.variacion != null).sort((a, b) => Math.abs(b.variacion!) - Math.abs(a.variacion!)).slice(0, isMobile ? 4 : 4);
  const dolarP    = dolar.filter(d => ['oficial','blue','bolsa','contadoconliqui'].includes(d.casa));
  const timeSince = lastUpdate ? Math.floor((Date.now()-lastUpdate.getTime())/1000) : null;

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: isMobile ? '20px' : '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Mercado</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>
            {timeSince != null ? `Datos al cierre · Actualizado hace ${timeSince<60?timeSince+'s':Math.floor(timeSince/60)+'m'}` : 'Cargando...'}
          </div>
        </div>
        <button onClick={fetchAll} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
        </button>
      </div>

      {/* Buscador */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? '100%' : '0', maxWidth: isMobile ? '100%' : '440px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="input-field" style={{ paddingLeft: '36px', width: '100%' }}
              placeholder="GD35 · AAPL · GOOGL · GGAL..."
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-primary" onClick={handleSearch} disabled={searching || !query.trim()} style={{ whiteSpace: 'nowrap' }}>
              {searching ? 'Buscando...' : 'Buscar'}
            </button>
            {result && (
              <button onClick={() => { setResult(null); setQuery(''); }} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {result && (
          result.error ? (
            <div className="card fade-in" style={{ borderColor: 'rgba(244,63,94,0.3)' }}>
              <div style={{ color: 'var(--red)', fontSize: '14px' }}>{result.error}</div>
            </div>
          ) : result.tipo === 'renta_fija' ? (
            <SearchResultRF r={result} />
          ) : result.tipo === 'cedear' ? (
            <SearchResultCedear r={result} />
          ) : (
            <SearchResultRV r={result} />
          )
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>Cargando datos...</div>
      ) : (
        <>
          {/* Hot Movers */}
          {hotMovers.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <div className="label-xs" style={{ marginBottom: '12px' }}>⚡ Hot Movers</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
                {hotMovers.map(a => (
                  <div key={a.ticker} onClick={() => setQuery(a.ticker)}
                    style={{ background: a.variacion!>0?'rgba(16,185,129,0.08)':'rgba(244,63,94,0.08)', border: `1px solid ${a.variacion!>0?'rgba(16,185,129,0.2)':'rgba(244,63,94,0.2)'}`, borderRadius: '12px', padding: isMobile ? '12px' : '16px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: isMobile ? '12px' : '14px', color: 'var(--text)' }}>{a.ticker}</span>
                      {a.variacion!>0 ? <TrendingUp size={16} color="var(--green)" /> : <TrendingDown size={16} color="var(--red)" />}
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: isMobile ? '15px' : '18px', fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>{'$'+(a.precio??0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: colorV(a.variacion) }}>{fmtPct(a.variacion)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dólar + CEDEARs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>💵 Dólar</div>
              {dolarP.map((d, i) => (
                <div key={d.casa} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i<dolarP.length-1?'1px solid var(--border)':'none' }}>
                  <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: 'var(--text2)' }}>{DOLAR_NOMBRES[d.casa] || d.nombre}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: 'var(--text)', fontWeight: 500 }}>${d.venta?.toLocaleString('es-AR')}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)' }}>Cpa ${d.compra?.toLocaleString('es-AR')}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>🇺🇸 CEDEARs · ARS</div>
              {cedears.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: '13px', fontFamily: 'DM Mono, monospace' }}>Cargando...</div>
              ) : cedears.map((c, i) => (
                <div key={c.ticker} onClick={() => setQuery(c.ticker)}
                  style={{ display: 'grid', gridTemplateColumns: '70px 1fr auto', alignItems: 'center', padding: '10px 0', borderBottom: i<cedears.length-1?'1px solid var(--border)':'none', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--violet-light)' }}>{c.ticker}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text)' }}>{fmtARS(c.precio)}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorV(c.variacion), textAlign: 'right' }}>{fmtPct(c.variacion)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Acciones + Bonos */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>🇦🇷 Acciones AR · Merval</div>
              {acciones.map((a, i) => (
                <div key={a.ticker} onClick={() => setQuery(a.ticker)}
                  style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', alignItems: 'center', padding: '10px 0', borderBottom: i<acciones.length-1?'1px solid var(--border)':'none', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{a.ticker}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text2)' }}>{'$'+(a.precio??0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorV(a.variacion), textAlign: 'right' }}>{fmtPct(a.variacion)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>📊 Bonos Soberanos</div>
              {bonos.map((b, i) => (
                <div key={b.ticker} onClick={() => setQuery(b.ticker)}
                  style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', alignItems: 'center', padding: '10px 0', borderBottom: i<bonos.length-1?'1px solid var(--border)':'none', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{b.ticker}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text2)' }}>{'$'+(b.precio??0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorV(b.variacion), textAlign: 'right' }}>{fmtPct(b.variacion)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

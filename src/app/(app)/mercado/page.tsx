'use client';
import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { Cotizacion, DolarRate } from '@/lib/types';

const US_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'];

const fmtARS = (n: number | null) =>
  n == null ? '—' : '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

const fmtPct = (n: number | null) => {
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
};

const fmtUSD = (n: number | null) =>
  n == null ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const colorVar = (n: number | null) =>
  n == null ? 'var(--text2)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text2)';

const DOLAR_NOMBRES: Record<string, string> = {
  oficial: 'Oficial', blue: 'Blue', bolsa: 'MEP', contadoconliqui: 'CCL',
  mayorista: 'Mayorista', cripto: 'Cripto', tarjeta: 'Tarjeta',
};

export default function MercadoPage() {
  const [acciones, setAcciones] = useState<Cotizacion[]>([]);
  const [bonos, setBonos] = useState<Cotizacion[]>([]);
  const [dolar, setDolar] = useState<DolarRate[]>([]);
  const [quotesUS, setQuotesUS] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [mercadoRes, dolarRes, usRes] = await Promise.all([
        fetch('/api/mercado'),
        fetch('/api/dolar'),
        fetch(`/api/quotes?tickers=${US_TICKERS.join(',')}&suffix=`),
      ]);
      const [mercado, dolarData, usData] = await Promise.all([
        mercadoRes.json(),
        dolarRes.json(),
        usRes.json(),
      ]);
      if (mercado.acciones) setAcciones(mercado.acciones);
      if (mercado.bonos) setBonos(mercado.bonos);
      if (Array.isArray(dolarData)) setDolar(dolarData);
      setQuotesUS(usData || {});
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const hotMovers = [...acciones]
    .filter(a => a.variacion != null)
    .sort((a, b) => Math.abs(b.variacion!) - Math.abs(a.variacion!))
    .slice(0, 4);

  const dolarPrincipales = dolar.filter(d =>
    ['oficial', 'blue', 'bolsa', 'contadoconliqui'].includes(d.casa)
  );

  const timeSince = lastUpdate
    ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
    : null;

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
            Mercado
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', fontFamily: 'DM Mono, monospace' }}>
            {timeSince != null ? `Actualizado hace ${timeSince < 60 ? timeSince + 's' : Math.floor(timeSince / 60) + 'm'}` : 'Cargando...'}
          </div>
        </div>
        <button onClick={fetchAll} disabled={refreshing} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          color: 'var(--text2)', borderRadius: '8px', padding: '8px 14px',
          cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans, sans-serif',
        }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontFamily: 'DM Mono, monospace', fontSize: '13px' }}>Cargando datos...</div>
      ) : (
        <>
          {/* Hot Movers */}
          {hotMovers.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <div className="label-xs" style={{ marginBottom: '12px' }}>⚡ Hot Movers</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                {hotMovers.map(a => (
                  <div key={a.ticker} style={{
                    background: a.variacion! > 0
                      ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)',
                    border: `1px solid ${a.variacion! > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
                    borderRadius: '12px', padding: '16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
                        {a.ticker}
                      </span>
                      {a.variacion! > 0
                        ? <TrendingUp size={16} color="var(--green)" />
                        : <TrendingDown size={16} color="var(--red)" />
                      }
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '18px', fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>
                      {fmtARS(a.precio)}
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: colorVar(a.variacion) }}>
                      {fmtPct(a.variacion)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dólar + US */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>

            {/* Dólar */}
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>💵 Dólar</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {dolarPrincipales.map((d, i) => (
                  <div key={d.casa} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: i < dolarPrincipales.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: 'var(--text2)' }}>
                      {DOLAR_NOMBRES[d.casa] || d.nombre}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '15px', color: 'var(--text)', fontWeight: 500 }}>
                        ${d.venta?.toLocaleString('es-AR')}
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--muted)' }}>
                        Cpa ${d.compra?.toLocaleString('es-AR')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Acciones US */}
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>🇺🇸 Acciones US</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {US_TICKERS.map((ticker, i) => {
                  const price = quotesUS[ticker];
                  return (
                    <div key={ticker} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 0',
                      borderBottom: i < US_TICKERS.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--violet-light)' }}>
                        {ticker}
                      </span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px', color: 'var(--text)' }}>
                        {price ? fmtUSD(price) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Acciones AR + Bonos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            {/* Acciones AR */}
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>🇦🇷 Acciones AR · Merval</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {acciones.map((a, i) => (
                  <div key={a.ticker} style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr auto',
                    alignItems: 'center', padding: '10px 0',
                    borderBottom: i < acciones.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>
                      {a.ticker}
                    </span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text2)' }}>
                      {fmtARS(a.precio)}
                    </span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorVar(a.variacion), textAlign: 'right' }}>
                      {fmtPct(a.variacion)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bonos */}
            <div className="card">
              <div className="label-xs" style={{ marginBottom: '16px' }}>📊 Bonos Soberanos</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {bonos.map((b, i) => (
                  <div key={b.ticker} style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr auto',
                    alignItems: 'center', padding: '10px 0',
                    borderBottom: i < bonos.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>
                      {b.ticker}
                    </span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--text2)' }}>
                      {fmtARS(b.precio)}
                    </span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: colorVar(b.variacion), textAlign: 'right' }}>
                      {fmtPct(b.variacion)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

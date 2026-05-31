import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FMP_API = 'https://financialmodelingprep.com/api/v3';

const SECTOR_FALLBACK: Record<string, { sector: string; industria: string; pais: string }> = {
  // Argentinas
  GGAL:  { sector: 'Financiero',     industria: 'Bancos',                pais: 'Argentina' },
  YPFD:  { sector: 'Energía',        industria: 'Oil & Gas',             pais: 'Argentina' },
  PAMP:  { sector: 'Energía',        industria: 'Utilities',             pais: 'Argentina' },
  BMA:   { sector: 'Financiero',     industria: 'Bancos',                pais: 'Argentina' },
  SUPV:  { sector: 'Financiero',     industria: 'Bancos',                pais: 'Argentina' },
  TXAR:  { sector: 'Materiales',     industria: 'Acero',                 pais: 'Argentina' },
  ALUA:  { sector: 'Materiales',     industria: 'Aluminio',              pais: 'Argentina' },
  CRES:  { sector: 'Consumo',        industria: 'Alimentos',             pais: 'Argentina' },
  MIRG:  { sector: 'Financiero',     industria: 'Seguros',               pais: 'Argentina' },
  TECO2: { sector: 'Comunicaciones', industria: 'Telecom',               pais: 'Argentina' },
  TGSU2: { sector: 'Energía',        industria: 'Gas',                   pais: 'Argentina' },
  TGNO4: { sector: 'Energía',        industria: 'Gas',                   pais: 'Argentina' },
  COME:  { sector: 'Industriales',   industria: 'Conglomerado',          pais: 'Argentina' },
  BYMA:  { sector: 'Financiero',     industria: 'Bolsa',                 pais: 'Argentina' },
  VALO:  { sector: 'Financiero',     industria: 'Servicios Financieros', pais: 'Argentina' },
  LOMA:  { sector: 'Materiales',     industria: 'Cemento',               pais: 'Argentina' },
  HARG:  { sector: 'Energía',        industria: 'Gas',                   pais: 'Argentina' },
  METR:  { sector: 'Energía',        industria: 'Utilities',             pais: 'Argentina' },
  CEPU:  { sector: 'Energía',        industria: 'Utilities',             pais: 'Argentina' },
  EDN:   { sector: 'Energía',        industria: 'Utilities',             pais: 'Argentina' },
  IRSA:  { sector: 'Real Estate',    industria: 'Inmuebles',             pais: 'Argentina' },
  MOLI:  { sector: 'Consumo',        industria: 'Alimentos',             pais: 'Argentina' },
  // Bonos soberanos AR
  AL30:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  AL35:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  AL41:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD29:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD30:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD35:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD38:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD41:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD46:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  AE38:  { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  // Tecnología
  AAPL:  { sector: 'Tecnología', industria: 'Hardware',        pais: 'US' },
  MSFT:  { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  GOOGL: { sector: 'Tecnología', industria: 'Internet',        pais: 'US' },
  GOOG:  { sector: 'Tecnología', industria: 'Internet',        pais: 'US' },
  META:  { sector: 'Tecnología', industria: 'Redes Sociales',  pais: 'US' },
  NVDA:  { sector: 'Tecnología', industria: 'Semiconductores', pais: 'US' },
  AMD:   { sector: 'Tecnología', industria: 'Semiconductores', pais: 'US' },
  ASML:  { sector: 'Tecnología', industria: 'Semiconductores', pais: 'Países Bajos' },
  INTC:  { sector: 'Tecnología', industria: 'Semiconductores', pais: 'US' },
  QCOM:  { sector: 'Tecnología', industria: 'Semiconductores', pais: 'US' },
  AVGO:  { sector: 'Tecnología', industria: 'Semiconductores', pais: 'US' },
  ORCL:  { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  CRM:   { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  ADBE:  { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  NOW:   { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  PLTR:  { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  SNOW:  { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  IBM:   { sector: 'Tecnología', industria: 'Software',        pais: 'US' },
  // Consumo / E-Commerce
  AMZN:  { sector: 'Consumo', industria: 'E-Commerce',       pais: 'US' },
  MELI:  { sector: 'Consumo', industria: 'E-Commerce',       pais: 'Argentina' },
  BABA:  { sector: 'Consumo', industria: 'E-Commerce',       pais: 'China' },
  EBAY:  { sector: 'Consumo', industria: 'E-Commerce',       pais: 'US' },
  WMT:   { sector: 'Consumo', industria: 'Retail',           pais: 'US' },
  TGT:   { sector: 'Consumo', industria: 'Retail',           pais: 'US' },
  COST:  { sector: 'Consumo', industria: 'Retail',           pais: 'US' },
  TSLA:  { sector: 'Consumo', industria: 'Autos Eléctricos', pais: 'US' },
  // Financiero
  JPM:   { sector: 'Financiero', industria: 'Bancos',           pais: 'US' },
  BAC:   { sector: 'Financiero', industria: 'Bancos',           pais: 'US' },
  GS:    { sector: 'Financiero', industria: 'Banca Inversión',  pais: 'US' },
  MS:    { sector: 'Financiero', industria: 'Banca Inversión',  pais: 'US' },
  V:     { sector: 'Financiero', industria: 'Pagos',            pais: 'US' },
  MA:    { sector: 'Financiero', industria: 'Pagos',            pais: 'US' },
  NU:    { sector: 'Financiero', industria: 'Fintech',          pais: 'Brasil' },
  // Energía
  XOM:   { sector: 'Energía', industria: 'Oil & Gas', pais: 'US' },
  CVX:   { sector: 'Energía', industria: 'Oil & Gas', pais: 'US' },
  PBR:   { sector: 'Energía', industria: 'Oil & Gas', pais: 'Brasil' },
  // Salud
  JNJ:   { sector: 'Salud', industria: 'Farmacéutica', pais: 'US' },
  PFE:   { sector: 'Salud', industria: 'Farmacéutica', pais: 'US' },
  // Comunicaciones / Streaming
  NFLX:  { sector: 'Comunicaciones', industria: 'Streaming',       pais: 'US' },
  DIS:   { sector: 'Comunicaciones', industria: 'Entretenimiento',  pais: 'US' },
  SPOT:  { sector: 'Comunicaciones', industria: 'Streaming',        pais: 'Suecia' },
  // Industriales
  UBER:  { sector: 'Industriales', industria: 'Transporte', pais: 'US' },
  // ETFs
  SPY:   { sector: 'ETF Diversif.', industria: 'S&P 500', pais: 'US' },
  QQQ:   { sector: 'ETF Diversif.', industria: 'Nasdaq',  pais: 'US' },
  EWZ:   { sector: 'ETF Diversif.', industria: 'Brasil',  pais: 'Brasil' },
  GLD:   { sector: 'Materiales',    industria: 'Oro',     pais: 'US' },
  // Cripto
  BTC:   { sector: 'Cripto', industria: 'Bitcoin',   pais: 'Global' },
  ETH:   { sector: 'Cripto', industria: 'Ethereum',  pais: 'Global' },
};

export async function POST(request: NextRequest) {
  try {
    const { tickers } = await request.json();
    if (!tickers?.length) return NextResponse.json({});

    // Normalizar: quitar D final para búsqueda (ASMLD → ASML)
    const normalize = (t: string) => {
      const u = t.toUpperCase();
      // Excepciones que terminan en D pero no son CEDEARs
      const NO_NORM = new Set(['YPFD', 'NDD', 'GD30', 'GD35', 'GD38', 'GD41', 'GD46', 'GD29']);
      if (NO_NORM.has(u)) return u;
      if (u.endsWith('D') && u.length > 2) return u.slice(0, -1);
      return u;
    };

    const upper = (tickers as string[]).map(t => normalize(t));

    // 1. Buscar en Supabase
    const { data: cached } = await supabase
      .from('ticker_metadata')
      .select('ticker, sector, industria, pais')
      .in('ticker', upper);

    const result: Record<string, { sector: string; industria: string; pais: string }> = {};
    const cachedSet = new Set<string>();

    (cached || []).forEach(row => {
      result[row.ticker] = { sector: row.sector, industria: row.industria, pais: row.pais };
      cachedSet.add(row.ticker);
    });

    // 2. Para los que no están cacheados
    const missing = upper.filter(t => !cachedSet.has(t));
    if (!missing.length) return NextResponse.json(result);

    const toFetch: string[] = [];

    for (const ticker of missing) {
      if (SECTOR_FALLBACK[ticker]) {
        result[ticker] = SECTOR_FALLBACK[ticker];
        // Cachear en Supabase
        supabase.from('ticker_metadata').upsert({
          ticker,
          ...SECTOR_FALLBACK[ticker],
          cached_at: new Date().toISOString(),
        }).then(() => {});
      } else {
        toFetch.push(ticker);
      }
    }

    // 3. Llamar FMP para los que no están en fallback
    if (toFetch.length && process.env.FMP_API_KEY) {
      await Promise.all(
        toFetch.map(async ticker => {
          try {
            // Ticker ya está normalizado (sin D)
            const res = await fetch(
              `${FMP_API}/profile/${ticker}?apikey=${process.env.FMP_API_KEY}`
            );
            const data = await res.json();
            if (data?.[0]?.sector) {
              const meta = {
                sector: data[0].sector || 'Otros',
                industria: data[0].industry || 'Otros',
                pais: data[0].country || 'US',
              };
              result[ticker] = meta;
              await supabase.from('ticker_metadata').upsert({
                ticker,
                ...meta,
                cached_at: new Date().toISOString(),
              });
            } else {
              result[ticker] = { sector: 'Otros', industria: 'Otros', pais: 'US' };
            }
          } catch {
            result[ticker] = { sector: 'Otros', industria: 'Otros', pais: 'US' };
          }
        })
      );
    } else {
      toFetch.forEach(ticker => {
        result[ticker] = { sector: 'Otros', industria: 'Otros', pais: 'US' };
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('ticker-sector error:', err);
    return NextResponse.json({});
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const FMP_API = 'https://financialmodelingprep.com/api/v3';

// Fallback hardcodeado para tickers argentinos que FMP no reconoce bien
const SECTOR_FALLBACK: Record<string, { sector: string; industria: string; pais: string }> = {
  GGAL: { sector: 'Financiero', industria: 'Bancos', pais: 'Argentina' },
  YPFD: { sector: 'Energía', industria: 'Oil & Gas', pais: 'Argentina' },
  PAMP: { sector: 'Energía', industria: 'Utilities', pais: 'Argentina' },
  BMA:  { sector: 'Financiero', industria: 'Bancos', pais: 'Argentina' },
  SUPV: { sector: 'Financiero', industria: 'Bancos', pais: 'Argentina' },
  TXAR: { sector: 'Materiales', industria: 'Acero', pais: 'Argentina' },
  ALUA: { sector: 'Materiales', industria: 'Aluminio', pais: 'Argentina' },
  CRES: { sector: 'Consumo', industria: 'Alimentos', pais: 'Argentina' },
  MIRG: { sector: 'Financiero', industria: 'Seguros', pais: 'Argentina' },
  TECO2: { sector: 'Comunicaciones', industria: 'Telecom', pais: 'Argentina' },
  TGSU2: { sector: 'Energía', industria: 'Gas', pais: 'Argentina' },
  TGNO4: { sector: 'Energía', industria: 'Gas', pais: 'Argentina' },
  COME: { sector: 'Industriales', industria: 'Conglomerado', pais: 'Argentina' },
  BYMA: { sector: 'Financiero', industria: 'Bolsa', pais: 'Argentina' },
  VALO: { sector: 'Financiero', industria: 'Servicios Financieros', pais: 'Argentina' },
  LOMA: { sector: 'Materiales', industria: 'Cemento', pais: 'Argentina' },
  HARG: { sector: 'Energía', industria: 'Gas', pais: 'Argentina' },
  METR: { sector: 'Energía', industria: 'Utilities', pais: 'Argentina' },
  CEPU: { sector: 'Energía', industria: 'Utilities', pais: 'Argentina' },
  EDN:  { sector: 'Energía', industria: 'Utilities', pais: 'Argentina' },
  IRSA: { sector: 'Real Estate', industria: 'Inmuebles', pais: 'Argentina' },
  MOLI: { sector: 'Consumo', industria: 'Alimentos', pais: 'Argentina' },
  // Bonos y letras → sin sector de empresa
  AL30: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  AL35: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD30: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD35: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD38: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  GD41: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
  AE38: { sector: 'Renta Fija', industria: 'Soberano AR', pais: 'Argentina' },
};

export async function POST(request: NextRequest) {
  try {
    const { tickers } = await request.json();
    if (!tickers?.length) return NextResponse.json({});

    const upper = (tickers as string[]).map(t => t.toUpperCase());

    // 1. Buscar cuáles ya están cacheados en Supabase
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

    // 2. Para los que no están cacheados, usar fallback o FMP
    const missing = upper.filter(t => !cachedSet.has(t));
    if (!missing.length) return NextResponse.json(result);

    const toFetch: string[] = [];
    missing.forEach(ticker => {
      if (SECTOR_FALLBACK[ticker]) {
        result[ticker] = SECTOR_FALLBACK[ticker];
        // Guardar fallback en Supabase también
        supabase.from('ticker_metadata').upsert({
          ticker,
          ...SECTOR_FALLBACK[ticker],
          cached_at: new Date().toISOString(),
        }).then(() => {});
      } else {
        toFetch.push(ticker);
      }
    });

    // 3. Los que no están en fallback → llamar FMP
    if (toFetch.length && process.env.FMP_API_KEY) {
      await Promise.all(
        toFetch.map(async ticker => {
          try {
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
      // Sin FMP key → marcar como Otros
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

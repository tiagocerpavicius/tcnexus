import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = 'd87kj21r01qmhakg6qcgd87kj21r01qmhakg6qd0';

const SECTOR_MAP: Record<string, string> = {
  'Technology':             'Tecnología',
  'Financial Services':     'Financiero',
  'Financial':              'Financiero',
  'Energy':                 'Energía',
  'Consumer Cyclical':      'Consumo masivo',
  'Consumer Defensive':     'Consumo masivo',
  'Healthcare':             'Salud',
  'Industrials':            'Industria',
  'Utilities':              'Industria',
  'Basic Materials':        'Materiales',
  'Real Estate':            'Inmobiliario',
  'Communication Services': 'Telecomunicaciones',
};

const CEDEAR_A_US: Record<string, string> = {
  'GOGL': 'GOOGL', 'BRKB': 'BRK-B', 'DISN': 'DIS',
  'GOLD': 'GOLD', 'YPFD': 'YPF', 'GLD': 'GLD',
};

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: 'Ticker requerido' }, { status: 400 });

  const base = ticker.endsWith('D') && ticker.length > 2 ? ticker.slice(0, -1) : ticker;
  const usTicker = CEDEAR_A_US[base] || base;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(usTicker)}&token=${FINNHUB_KEY}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 86400 } }
    );
    if (!res.ok) return NextResponse.json({ error: 'No data' }, { status: 404 });
    const data = await res.json();
    if (!data.name) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const sector = data.sector ? (SECTOR_MAP[data.sector] || data.finnhubIndustry || 'Otro') : 'Otro';

    return NextResponse.json({
      nombre: data.name || usTicker,
      sector,
      industria: data.finnhubIndustry || null,
      pais: data.country || null,
      web: data.weburl || null,
    });
  } catch {
    return NextResponse.json({ error: 'Error fetching profile' }, { status: 500 });
  }
}

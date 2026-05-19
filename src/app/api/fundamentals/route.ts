import { NextRequest, NextResponse } from 'next/server';

const CEDEAR_A_US: Record<string, string> = {
  'GOGL': 'GOOGL', 'BRKB': 'BRK-B', 'DISN': 'DIS',
  'GOLD': 'GOLD', 'YPFD': 'YPF', 'GLD': 'GLD',
};

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  const suffix = request.nextUrl.searchParams.get('suffix') ?? '';
  if (!ticker) return NextResponse.json({ error: 'Ticker requerido' }, { status: 400 });

  const usTicker = CEDEAR_A_US[ticker] || ticker;

  try {
    const controller = new AbortController();
    // 9s: cubre cold start GAS (2-4s) + GOOGLEFINANCE sleep (2.5s) + overhead
    const timer = setTimeout(() => controller.abort(), 9000);
    const url = `${process.env.APPS_SCRIPT_URL}?action=details&ticker=${encodeURIComponent(usTicker)}&suffix=${encodeURIComponent(suffix)}`;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();

    if (data?.precio != null && !data.error) {
      return NextResponse.json({
        nombre: data.nombre ?? null,
        marketCap: data.marketCap ?? null,
        per: data.per ?? null,
        eps: data.eps ?? null,
        beta: data.beta ?? null,
        maximo52: data.maximo52 ?? null,
        minimo52: data.minimo52 ?? null,
      });
    }
  } catch {}

  return NextResponse.json({ error: 'No data' }, { status: 404 });
}

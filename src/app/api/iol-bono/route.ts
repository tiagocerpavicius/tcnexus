import { NextRequest, NextResponse } from 'next/server';
import { getIOLToken } from '@/lib/iol';

// TEMP: endpoint de diagnóstico para comparar la respuesta cruda de IOL entre
// term=T0 y term=T1 para un ticker dado. No lo usa ninguna pantalla.
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker') || 'AMZN';
  const market = request.nextUrl.searchParams.get('market') || 'BCBA';

  const token = await getIOLToken();
  if (!token) return NextResponse.json({ error: 'Auth failed' });

  const fetchTerm = async (term: string) => {
    const url = `https://api.iolinversiones.com/broker/market-data/${encodeURIComponent(ticker)}/quote?market=${market}&term=${term}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    } catch (err) {
      return { status: null, ok: false, error: String(err) };
    }
  };

  const [t0, t1] = await Promise.all([fetchTerm('T0'), fetchTerm('T1')]);

  return NextResponse.json({ ticker, market, t0, t1 });
}

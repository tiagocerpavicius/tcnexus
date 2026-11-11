import { NextRequest, NextResponse } from 'next/server';
import { getIOLToken, getIOLHistorico } from '@/lib/iol';

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  const fechaDesde = request.nextUrl.searchParams.get('fechaDesde');
  const fechaHasta = request.nextUrl.searchParams.get('fechaHasta');

  if (!ticker || !fechaDesde || !fechaHasta) {
    return NextResponse.json({ error: 'Parámetros requeridos: ticker, fechaDesde, fechaHasta' }, { status: 400 });
  }

  try {
    const token = await getIOLToken();
    if (!token) return NextResponse.json({ error: 'No se pudo obtener token IOL' }, { status: 401 });

    const historico = await getIOLHistorico(token, ticker, fechaDesde, fechaHasta);
    return NextResponse.json({ ticker, historico });
  } catch (err) {
    console.error('historico-iol error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

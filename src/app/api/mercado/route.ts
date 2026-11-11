import { NextResponse } from 'next/server';
import { getIOLToken, getIOLCotizacion } from '@/lib/iol';

const ACCIONES_AR = ['YPFD', 'GGAL', 'BMA', 'BBAR', 'TXAR', 'LOMA', 'TGSU2', 'ALUA', 'PAMP', 'CRES'];
const BONOS_SOB = ['GD30', 'GD35', 'GD38', 'GD41', 'AL30', 'AL35', 'AE38', 'AO28'];
const CEDEARS_POP = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'];

async function getCotizacion(token: string, ticker: string) {
  const data = await getIOLCotizacion(token, ticker);
  if (!data) return null;
  return {
    ticker,
    precio: data.ultimoPrecio,
    variacion: data.variacion,
    apertura: data.apertura,
    maximo: data.maximo,
    minimo: data.minimo,
    volumen: data.cantidadOperada,
  };
}

export async function GET() {
  const token = await getIOLToken();
  if (!token) return NextResponse.json({ error: 'IOL auth failed' }, { status: 500 });

  const [accionesRaw, bonosRaw, cedearsRaw] = await Promise.all([
    Promise.all(ACCIONES_AR.map(t => getCotizacion(token, t))),
    Promise.all(BONOS_SOB.map(t => getCotizacion(token, t))),
    Promise.all(CEDEARS_POP.map(t => getCotizacion(token, t))),
  ]);

  return NextResponse.json({
    acciones: accionesRaw.filter(Boolean),
    bonos: bonosRaw.filter(Boolean),
    cedears: cedearsRaw.filter(Boolean),
  });
}

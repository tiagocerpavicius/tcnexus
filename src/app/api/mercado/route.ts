import { NextResponse } from 'next/server';

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_API = 'https://api.invertironline.com/api/v2';

const ACCIONES_AR = ['YPFD', 'GGAL', 'BMA', 'BBAR', 'TXAR', 'LOMA', 'TGSU2', 'ALUA', 'PAMP', 'CRES'];
const BONOS_SOB = ['GD30', 'GD35', 'GD38', 'GD41', 'AL30', 'AL35', 'AE38', 'AO28'];
const CEDEARS_POP = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'];

async function getToken(): Promise<string | null> {
  try {
    const res = await fetch(IOL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: process.env.IOL_USERNAME!,
        password: process.env.IOL_PASSWORD!,
        grant_type: 'password',
      }),
    });
    return (await res.json()).access_token || null;
  } catch { return null; }
}

async function getCotizacion(token: string, ticker: string) {
  try {
    const res = await fetch(`${IOL_API}/bCBA/Titulos/${ticker}/cotizacion`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      ticker,
      precio: data.ultimoPrecio ?? null,
      variacion: data.variacion ?? null,
      apertura: data.apertura ?? null,
      maximo: data.maximo ?? null,
      minimo: data.minimo ?? null,
      volumen: data.cantidadOperada ?? null,
    };
  } catch { return null; }
}

export async function GET() {
  const token = await getToken();
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

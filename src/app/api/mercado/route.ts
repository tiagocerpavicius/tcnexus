import { NextResponse } from 'next/server';

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_API = 'https://api.invertironline.com/api/v2';

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
    const data = await res.json();
    return data.access_token || null;
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
      volumen: data.montoOperado ?? null,
    };
  } catch { return null; }
}

const ACCIONES = ['YPFD', 'GGAL', 'PAMP', 'BBAR', 'TGSU2', 'ALUA', 'LOMA', 'TXAR', 'VALO', 'BYMA'];
const BONOS = ['AL30', 'GD30', 'GD35', 'AL35', 'GD41', 'AE38', 'GD29', 'AL29'];

export async function GET() {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: 'Auth IOL failed' }, { status: 401 });

  const [acciones, bonos] = await Promise.all([
    Promise.all(ACCIONES.map(t => getCotizacion(token, t))),
    Promise.all(BONOS.map(t => getCotizacion(token, t))),
  ]);

  return NextResponse.json({
    acciones: acciones.filter(Boolean),
    bonos: bonos.filter(Boolean),
    timestamp: new Date().toISOString(),
  });
}

import { NextRequest, NextResponse } from 'next/server';

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
    return (await res.json()).access_token || null;
  } catch { return null; }
}

function toIOLDate(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  const fechaDesde = request.nextUrl.searchParams.get('fechaDesde');
  const fechaHasta = request.nextUrl.searchParams.get('fechaHasta');

  if (!ticker || !fechaDesde || !fechaHasta) {
    return NextResponse.json({ error: 'Parámetros requeridos: ticker, fechaDesde, fechaHasta' }, { status: 400 });
  }

  try {
    const token = await getToken();
    if (!token) return NextResponse.json({ error: 'No se pudo obtener token IOL' }, { status: 401 });

    const url = `${IOL_API}/bCBA/Titulos/${ticker}/Cotizacion/seriehistorica/${toIOLDate(fechaDesde)}/${toIOLDate(fechaHasta)}/ajustada`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('IOL historico error:', res.status, errText);
      return NextResponse.json({ error: 'Error IOL', status: res.status }, { status: res.status });
    }

    const data = await res.json();

    // Normalizar respuesta
    const historico = (Array.isArray(data) ? data : [])
      .map((item: any) => ({
        fecha: item.fechaHora?.split('T')[0] || '',
        cierre: item.ultimoPrecio ?? item.precioAjustado ?? null,
        apertura: item.apertura ?? null,
        maximo: item.maximo ?? null,
        minimo: item.minimo ?? null,
        volumen: item.cantidadOperada ?? null,
      }))
      .filter((item: any) => item.fecha && item.cierre != null)
      .sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));

    return NextResponse.json({ ticker, historico });
  } catch (err) {
    console.error('historico-iol error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

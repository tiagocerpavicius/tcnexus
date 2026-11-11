import { NextResponse } from 'next/server';
import { getIOLToken, getIOLAsset, getIOLCotizacion, getIOLPanels } from '@/lib/iol';

export async function GET() {
  const token = await getIOLToken();
  if (!token) return NextResponse.json({ error: 'Auth failed' });

  // Testeamos el endpoint de instrumento, cotización y paneles
  const [titulo, cotizacion, paneles] = await Promise.all([
    getIOLAsset(token, 'GD35').catch(() => null),
    getIOLCotizacion(token, 'GD35').catch(() => null),
    getIOLPanels(token, 'AR', 'government_bonds').catch(() => null),
  ]);

  return NextResponse.json({ titulo, cotizacion, paneles });
}

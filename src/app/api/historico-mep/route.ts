import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', {
      next: { revalidate: 3600 }, // cachear 1 hora
    });
    if (!res.ok) return NextResponse.json({ error: 'Error fetching MEP' }, { status: 500 });
    const data = await res.json();
    // data es array de { fecha: 'yyyy-MM-dd', compra: number, venta: number }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares');
    const data = await res.json();
    if (Array.isArray(data)) return NextResponse.json(data);
    // Si dolarapi devuelve un solo objeto (ej. caído parcialmente), lo envolvemos igual
    // para que los consumidores que esperan un array (buscan casa==='bolsa') no rompan.
    return NextResponse.json([{ ...data, casa: data?.casa || 'bolsa' }]);
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/bolsa');
    const data = await res.json();
    if (Array.isArray(data)) return NextResponse.json(data);
    return NextResponse.json([{ ...data, casa: 'bolsa' }]);
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

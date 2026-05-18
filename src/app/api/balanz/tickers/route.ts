import { NextResponse } from 'next/server';
import { balanzGet } from '@/lib/balanz';

export async function GET() {
  if (!process.env.BALANZ_COOKIE) return NextResponse.json({ error: 'BALANZ_COOKIE no configurada' }, { status: 500 });
  try {
    const data = await balanzGet('/tickers');
    return NextResponse.json(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
      return NextResponse.json({ error: 'Sesión Balanz expirada', authExpired: true }, { status: 401 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const ticker  = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  const suffix  = request.nextUrl.searchParams.get('suffix')  ?? '';
  const range   = request.nextUrl.searchParams.get('range')   ?? '1y';
  const interval = request.nextUrl.searchParams.get('interval') ?? '1d';

  if (!ticker) return NextResponse.json({ error: 'Ticker requerido' }, { status: 400 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const url = `${process.env.APPS_SCRIPT_URL}?action=history&ticker=${encodeURIComponent(ticker)}&suffix=${encodeURIComponent(suffix)}&range=${range}&interval=${interval}`;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data?.error) return NextResponse.json({ error: data.error }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Error fetching history' }, { status: 500 });
  }
}

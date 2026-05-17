import { NextRequest, NextResponse } from 'next/server';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL!;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tickers = searchParams.get('tickers')?.split(',').filter(Boolean) ?? [];
  const suffix = searchParams.get('suffix') ?? '.BA';

  if (!tickers.length) return NextResponse.json({});

  try {
    const url = `${APPS_SCRIPT_URL}?action=quotes&tickers=${tickers.join(',')}&suffix=${encodeURIComponent(suffix)}`;
    const res = await fetch(url, { redirect: 'follow' });
    const prices = await res.json();
    return NextResponse.json(prices);
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

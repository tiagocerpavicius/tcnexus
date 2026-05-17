import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares');
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

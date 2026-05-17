import { NextResponse } from 'next/server';

async function getToken() {
  const res = await fetch('https://api.invertironline.com/token', {
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
}

export async function GET() {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: 'Auth failed' });

  // Testeamos el endpoint de instrumento (sin /cotizacion)
  const [titulo, cotizacion, paneles] = await Promise.all([
    fetch('https://api.invertironline.com/api/v2/bCBA/Titulos/GD35', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).catch(() => null),
    fetch('https://api.invertironline.com/api/v2/bCBA/Titulos/GD35/cotizacion', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).catch(() => null),
    fetch('https://api.invertironline.com/api/v2/bCBA/Paneles', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).catch(() => null),
  ]);

  return NextResponse.json({ titulo, cotizacion, paneles });
}

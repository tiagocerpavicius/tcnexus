import { NextRequest, NextResponse } from 'next/server';
import { balanzGet, parsearFlujoBalanz, parsearIndicadoresBalanz, getMep } from '@/lib/balanz';

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  const vn = request.nextUrl.searchParams.get('vn') || '100';

  if (!ticker) return NextResponse.json({ error: 'Ticker requerido' }, { status: 400 });
  if (!process.env.BALANZ_COOKIE) return NextResponse.json({ error: 'BALANZ_COOKIE no configurada' }, { status: 500 });

  // Detectar moneda según sufijo D
  const esD = ticker.endsWith('D');
  const moneda = esD ? 'Dolares' : 'Pesos';
  const hoy = new Date().toISOString().split('T')[0];

  try {
    const mep = await getMep();

    // Datos básicos del bono
    let datosBono: any = null;
    try { datosBono = await balanzGet(`/datosBono/${ticker}/${hoy}`); } catch {}

    // Analytics completos (TIR, Duration, flujo, cupón, ley)
    const analytics = await balanzGet(
      `/flujoIndicadores/${ticker}/${hoy}/1/Dirty/${moneda}/${mep}/0/0/0/x/${vn}`
    );

    const cupon = Array.isArray(analytics.cupon) ? analytics.cupon[0] : null;
    const laminaLey = Array.isArray(analytics.laminaLey) ? analytics.laminaLey[0] : null;
    const flujos = parsearFlujoBalanz(analytics.flujo || datosBono?.flujo || []);
    const indicadores = parsearIndicadoresBalanz(analytics.indicadores || []);

    return NextResponse.json({
      ticker,
      hoy,
      mep,
      moneda,
      ok: true,
      spec: {
        tasaCupon: cupon?.cuponval ? parseFloat(cupon.cuponval) : null,
        cuponDesc: cupon?.cupondesc || null,
        cuponTexto: cupon?.obtenercupon || null,
        ley: laminaLey?.ley === 'NY' ? 'nueva_york' : laminaLey?.ley === 'AR' ? 'argentina' : laminaLey?.ley || null,
        laminaMinima: laminaLey?.laminaminima ? parseInt(laminaLey.laminaminima) : null,
      },
      indicadores,
      flujos,
      cantFlujos: flujos.length,
      proximoPago: flujos[0] || null,
    });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
      return NextResponse.json({ error: 'Sesión Balanz expirada. Renovar BALANZ_COOKIE en Vercel.', authExpired: true }, { status: 401 });
    }
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}

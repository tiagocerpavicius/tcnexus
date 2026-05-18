import { NextRequest, NextResponse } from 'next/server';
import { buscarBono, getAnalytics } from '@/lib/bonos';
import { balanzGet, parsearFlujoBalanz, parsearIndicadoresBalanz, getMep } from '@/lib/balanz';

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_API = 'https://api.invertironline.com/api/v2';

async function getToken(): Promise<string | null> {
  try {
    const res = await fetch(IOL_TOKEN_URL, {
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
  } catch { return null; }
}

async function getIOLPrecio(token: string, ticker: string) {
  try {
    const res = await fetch(`${IOL_API}/bCBA/Titulos/${ticker}/cotizacion`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function getYahooDetails(ticker: string, suffix: string) {
  try {
    const url = `${process.env.APPS_SCRIPT_URL}?action=details&ticker=${ticker}&suffix=${encodeURIComponent(suffix)}`;
    const res = await fetch(url, { redirect: 'follow' });
    return await res.json();
  } catch { return null; }
}

function parsearVto(desc: string): string | null {
  const m = desc?.match(/V\.(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: 'Ticker requerido' }, { status: 400 });

  const esD = ticker.endsWith('D');
  const monedaLabel = esD ? 'USD' : 'ARS';

  // ── 1. BALANZ (primario para renta fija) ─────────────────
  if (process.env.BALANZ_COOKIE) {
    try {
      const moneda = esD ? 'Dolares' : 'Pesos';
      const hoy = new Date().toISOString().split('T')[0];
      const mep = await getMep();

      let datosBono: any = null;
      try { datosBono = await balanzGet(`/datosBono/${ticker}/${hoy}`); } catch {}

      const analytics = await balanzGet(
        `/flujoIndicadores/${ticker}/${hoy}/1/Dirty/${moneda}/${mep}/0/0/0/x/100`
      );

      const cupon = Array.isArray(analytics.cupon) ? analytics.cupon[0] : null;
      const laminaLey = Array.isArray(analytics.laminaLey) ? analytics.laminaLey[0] : null;
      const flujos = parsearFlujoBalanz(analytics.flujo || datosBono?.flujo || []);
      const indicadores = parsearIndicadoresBalanz(analytics.indicadores || []);

      // Solo retornar si realmente hay datos de bono
      if (flujos.length > 0 || indicadores?.tir) {
        // Precio desde IOL
        const token = await getToken();
        const iolData = token ? await getIOLPrecio(token, ticker) : null;
        let precioValor = iolData?.ultimoPrecio ?? null;
        let fuentePrecio = `IOL (${monedaLabel})`;

        // Si es ARS y no encontró, intentar conversión
        if (!precioValor && !esD && token) {
          const iolARS = await getIOLPrecio(token, ticker.replace(/D$/, ''));
          if (iolARS?.ultimoPrecio) { precioValor = iolARS.ultimoPrecio; fuentePrecio = 'IOL (ARS)'; }
        }

        return NextResponse.json({
          ticker,
          tipo: 'renta_fija',
          fuente: 'Balanz',
          enBaseDeDatos: true,
          monedaLabel,
          spec: {
            nombre: cupon?.cuponTexto || cupon?.obtenercupon || ticker,
            emisor: '',
            tipoBono: 'soberano',
            moneda: monedaLabel,
            ley: laminaLey?.ley === 'NY' ? 'nueva_york' : laminaLey?.ley === 'AR' ? 'argentina' : 'argentina',
            tasaCupon: cupon?.cuponval ? parseFloat(cupon.cuponval) : null,
            cuponDesc: cupon?.cupondesc || null,
            laminaMinima: laminaLey?.laminaminima ? parseInt(laminaLey.laminaminima) : null,
            esAprox: false,
          },
          precio: {
            valor: precioValor,
            moneda: monedaLabel,
            variacion: iolData?.variacion ?? null,
            apertura: iolData?.apertura ?? null,
            maximo: iolData?.maximo ?? null,
            minimo: iolData?.minimo ?? null,
            cierreAnterior: iolData?.cierreAnterior ?? null,
            fechaHora: iolData?.fechaHora ?? null,
            fuente: fuentePrecio,
          },
          analytics: {
            tir: indicadores?.tir ?? null,
            duration: indicadores?.duration ?? null,
            durationMod: indicadores?.durationMod ?? null,
            paridad: indicadores?.paridad ?? null,
            precioDirty: indicadores?.precioDirty ?? null,
            precioClean: indicadores?.precioClean ?? null,
            interesCorreido: indicadores?.interesCorreido ?? null,
            pvbp: indicadores?.pvbp ?? null,
            flujos,
            cantFlujos: flujos.length,
            proximoPago: flujos[0] || null,
          },
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== 'AUTH_EXPIRED') {
        // No es error de auth, simplemente no es un bono en Balanz
      }
    }
  }

  // ── 2. FALLBACK: base de datos local + IOL ────────────────
  const spec = buscarBono(ticker);
  if (spec) {
    const token = await getToken();
    const iolData = token ? (await getIOLPrecio(token, ticker) || await getIOLPrecio(token, ticker.replace(/D$/, ''))) : null;
    let precioValor: number | null = null;
    let fuentePrecio = `IOL (${monedaLabel})`;

    if (iolData?.ultimoPrecio) {
      if (esD) {
        precioValor = iolData.ultimoPrecio;
      } else {
        precioValor = iolData.ultimoPrecio;
      }
    }

    if (precioValor) {
      // Para analytics necesitamos precio USD
      const precioUSD = esD ? precioValor : precioValor / (await getMep());
      const anal = getAnalytics(spec, precioUSD);
      return NextResponse.json({
        ticker,
        tipo: 'renta_fija',
        fuente: 'Base local',
        enBaseDeDatos: true,
        monedaLabel,
        spec: {
          nombre: spec.nombre, emisor: spec.emisor, tipoBono: spec.tipo,
          moneda: monedaLabel, ley: spec.ley, sector: spec.sector,
          tasaCupon: spec.tasaCupon, vencimiento: spec.vencimiento,
          vnResidual: spec.vnResidual, esAprox: spec.esAprox || false,
        },
        precio: {
          valor: precioValor,
          moneda: monedaLabel,
          variacion: iolData?.variacion ?? null,
          apertura: iolData?.apertura ?? null,
          maximo: iolData?.maximo ?? null,
          minimo: iolData?.minimo ?? null,
          fechaHora: iolData?.fechaHora ?? null,
          fuente: fuentePrecio,
        },
        analytics: anal,
      });
    }
  }

  // ── 3. IOL básico (precio + info mínima) ──────────────────
  const token = await getToken();
  if (token) {
    const iolRaw = await getIOLPrecio(token, ticker);
    if (iolRaw) {
      const rawData = iolRaw.cotizacion || iolRaw;
      const desc = iolRaw.titulo?.descripcion || rawData.descripcionTitulo || '';
      const vto = parsearVto(desc);
      if (vto || rawData.ultimoPrecio) {
        return NextResponse.json({
          ticker, tipo: 'renta_fija', fuente: 'IOL básico',
          enBaseDeDatos: false, monedaLabel,
          spec: { nombre: desc, vencimiento: vto, moneda: monedaLabel, esAprox: true },
          precio: { valor: rawData.ultimoPrecio, moneda: monedaLabel, variacion: rawData.variacion ?? null, fechaHora: rawData.fechaHora ?? null, fuente: 'IOL' },
          analytics: null,
          requiereSpecs: true,
        });
      }
    }
  }

  // ── 4. RENTA VARIABLE (Yahoo Finance) ─────────────────────
  const detailsAR = await getYahooDetails(ticker, '.BA');
  if (detailsAR?.precio) return NextResponse.json({ ...detailsAR, tipo: 'renta_variable', fuente: 'Yahoo Finance' });

  const detailsUS = await getYahooDetails(ticker, '');
  if (detailsUS?.precio) return NextResponse.json({ ...detailsUS, tipo: 'renta_variable', fuente: 'Yahoo Finance' });

  return NextResponse.json({ error: `"${ticker}" no encontrado` }, { status: 404 });
}

import { NextRequest, NextResponse } from 'next/server';
import { buscarBono, getAnalytics } from '@/lib/bonos';
import { balanzGet, parsearFlujoBalanz, parsearIndicadoresBalanz, getMep } from '@/lib/balanz';

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_API = 'https://api.invertironline.com/api/v2';

// Patrones de bonos: tienen dígitos en el ticker base (GD35, AL30, CO35, etc.)
function esBono(ticker: string): boolean {
  const base = ticker.replace(/D$/, '');
  return /\d/.test(base) || buscarBono(ticker) !== null;
}

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
    return (await res.json()).access_token || null;
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
  const token = await getToken();

  // ── 1. BALANZ (solo para bonos) ───────────────────────────
  if (process.env.BALANZ_COOKIE) {
    try {
      const moneda = esD ? 'Dolares' : 'Pesos';
      const hoy = new Date().toISOString().split('T')[0];
      const mep = await getMep();

      let datosBono: any = null;
      try { datosBono = await balanzGet(`/datosBono/${ticker}/${hoy}`); } catch {}

      const analyticsRaw = await balanzGet(
        `/flujoIndicadores/${ticker}/${hoy}/1/Dirty/${moneda}/${mep}/0/0/0/x/100`
      );

      const cupon = Array.isArray(analyticsRaw.cupon) ? analyticsRaw.cupon[0] : null;
      const laminaLey = Array.isArray(analyticsRaw.laminaLey) ? analyticsRaw.laminaLey[0] : null;
      const flujos = parsearFlujoBalanz(analyticsRaw.flujo || datosBono?.flujo || []);
      const indicadores = parsearIndicadoresBalanz(analyticsRaw.indicadores || []);

      if (flujos.length > 0 || indicadores?.tir) {
        // Precio desde IOL
        const iolData = token ? await getIOLPrecio(token, ticker) : null;
        const precioValor = iolData?.ultimoPrecio ?? null;

        // Si TIR de Balanz es nula, calcular local con precio convertido a USD
        let tirFinal = indicadores?.tir ?? null;
        if (!tirFinal && precioValor && flujos.length > 0) {
          const precioUSD = esD ? precioValor : precioValor / mep;
          const { calcularTIR } = await import('@/lib/bonos');
          tirFinal = calcularTIR(precioUSD, flujos);
        }

        return NextResponse.json({
          ticker,
          tipo: 'renta_fija',
          fuente: 'Balanz',
          enBaseDeDatos: true,
          monedaLabel,
          spec: {
            nombre: cupon?.obtenercupon || cupon?.cuponTexto || ticker,
            moneda: monedaLabel,
            ley: laminaLey?.ley === 'NY' ? 'nueva_york' : 'argentina',
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
            fuente: `IOL (${monedaLabel})`,
          },
          analytics: {
            tir: tirFinal,
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
      if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
        console.warn('Balanz cookie expirada, usando fallback');
      }
    }
  }

  // ── 2. BASE LOCAL + IOL (fallback bonos) ──────────────────
  const spec = buscarBono(ticker);
  if (spec) {
    const mep = await getMep();
    const iolData = token
      ? await getIOLPrecio(token, ticker) || await getIOLPrecio(token, ticker.replace(/D$/, ''))
      : null;
    const precioValor = iolData?.ultimoPrecio ?? null;

    if (precioValor) {
      // Convertir a USD para el cálculo (siempre trabajamos en USD)
      const precioUSD = esD ? precioValor : precioValor / mep;
      const anal = getAnalytics(spec, precioUSD);

      return NextResponse.json({
        ticker,
        tipo: 'renta_fija',
        fuente: 'Base local',
        enBaseDeDatos: true,
        monedaLabel,
        spec: {
          nombre: spec.nombre, moneda: monedaLabel, ley: spec.ley,
          sector: spec.sector, tasaCupon: spec.tasaCupon,
          vencimiento: spec.vencimiento, vnResidual: spec.vnResidual,
          esAprox: spec.esAprox || false,
        },
        precio: {
          valor: precioValor, moneda: monedaLabel,
          variacion: iolData?.variacion ?? null,
          apertura: iolData?.apertura ?? null,
          maximo: iolData?.maximo ?? null,
          minimo: iolData?.minimo ?? null,
          fechaHora: iolData?.fechaHora ?? null,
          fuente: `IOL (${monedaLabel})`,
        },
        analytics: anal,
      });
    }
  }

  // ── 3. IOL básico (si es bono pero sin specs) ─────────────
  if (!esD && token) {
    const iolRaw = await getIOLPrecio(token, ticker);
    if (iolRaw) {
      const raw = iolRaw.cotizacion || iolRaw;
      const desc = iolRaw.titulo?.descripcion || raw.descripcionTitulo || '';
      if (raw.ultimoPrecio) {
        return NextResponse.json({
          ticker, tipo: 'renta_fija', fuente: 'IOL básico',
          enBaseDeDatos: false, monedaLabel,
          spec: { nombre: desc, vencimiento: parsearVto(desc), moneda: monedaLabel, esAprox: true },
          precio: { valor: raw.ultimoPrecio, moneda: monedaLabel, variacion: raw.variacion ?? null, fechaHora: raw.fechaHora ?? null, fuente: 'IOL' },
          analytics: null,
          requiereSpecs: true,
        });
      }
    }
  }

  // ── 4. RENTA VARIABLE / CEDEAR (Yahoo Finance) ────────────

  // CEDEARs en D: buscar como .BA en Yahoo Finance
  if (esD) {
    const base = ticker.replace(/D$/, '');
    const detailsCedear = await getYahooDetails(base, '.BA');
    if (detailsCedear?.precio) {
      return NextResponse.json({
        ...detailsCedear,
        ticker,
        tipo: 'cedear',
        fuente: 'Yahoo Finance',
        monedaLabel: 'ARS',
      });
    }
    // Si no encuentra en .BA, mostrar precio IOL D
    if (token) {
      const iolD = await getIOLPrecio(token, ticker);
      if (iolD?.ultimoPrecio) {
        return NextResponse.json({
          ticker, tipo: 'cedear', fuente: 'IOL D',
          monedaLabel: 'USD',
          precio: { valor: iolD.ultimoPrecio, moneda: 'USD', variacion: iolD.variacion ?? null, fechaHora: iolD.fechaHora ?? null, fuente: 'IOL D' },
          analytics: null,
        });
      }
    }
  }

  // Acciones AR (.BA)
  const detailsAR = await getYahooDetails(ticker, '.BA');
  if (detailsAR?.precio) return NextResponse.json({ ...detailsAR, tipo: 'renta_variable', fuente: 'Yahoo Finance' });

  // Acciones US
  const detailsUS = await getYahooDetails(ticker, '');
  if (detailsUS?.precio) return NextResponse.json({ ...detailsUS, tipo: 'renta_variable', fuente: 'Yahoo Finance' });

  return NextResponse.json({ error: `"${ticker}" no encontrado` }, { status: 404 });
}

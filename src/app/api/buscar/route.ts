import { NextRequest, NextResponse } from 'next/server';
import { buscarBono, getAnalytics, calcularTIR } from '@/lib/bonos';
import { balanzGet, parsearFlujoBalanz, parsearIndicadoresBalanz, getMep } from '@/lib/balanz';

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_API = 'https://api.invertironline.com/api/v2';

// CEDEARs cuyo ticker en ARS termina en D (el D es parte del nombre, NO indica segmento USD).
// Para estos, el USD se forma con doble D: YPFD (ARS) → YPFDD (USD).
const ARS_TERMINAN_EN_D = new Set(['YPFD']);

// Mapa de base-ticker → ticker US real para Yahoo/Apps Script.
// Incluye bases de tickers DD (YPFDD → base YPFD → subyacente YPF).
const CEDEAR_A_US: Record<string, string> = {
  'GOGL': 'GOOGL',
  'BRKB': 'BRK-B',
  'DISN': 'DIS',
  'GOLD': 'GOLD',
  'YPFD': 'YPF',   // cubre YPFD (ARS) y YPFDD (USD, base = YPFD)
  'GLD': 'GLD',    // cubre GLD (ARS) y GLDD (USD, base = GLD)
};

function getUSTicker(base: string): string {
  return CEDEAR_A_US[base] || base;
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

// Timeout de 4s por intento + una retry. Fallback a quotes si details falla.
async function getYahooDetails(ticker: string, suffix: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const url = `${process.env.APPS_SCRIPT_URL}?action=details&ticker=${ticker}&suffix=${encodeURIComponent(suffix)}`;
      const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data?.precio != null && !data.error) return data;
    } catch {}
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const qUrl = `${process.env.APPS_SCRIPT_URL}?action=quotes&tickers=${ticker}&suffix=${encodeURIComponent(suffix)}`;
    const qRes = await fetch(qUrl, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const qData = await qRes.json();
    if (qData?.[ticker] != null) return { ticker, precio: qData[ticker] };
  } catch {}
  return null;
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

  const esD = ticker.endsWith('D') && !ARS_TERMINAN_EN_D.has(ticker);
  const monedaLabel = esD ? 'USD' : 'ARS';
  const token = await getToken();

  // ── 1. BALANZ ─────────────────────────────────────────────
  if (process.env.BALANZ_COOKIE) {
    try {
      const moneda = esD ? 'Dolares' : 'Pesos';
      const hoy = new Date().toISOString().split('T')[0];
      const mep = await getMep();
      const tickerBase = esD ? ticker.slice(0, -1) : ticker;

      // ONs en D: Balanz las conoce con sufijo O (YM34D → YM34O).
      // Soberanos en D: sin O (GD35D → GD35).
      // Probamos O primero; si no tiene flujos, probamos sin O.
      const tickerBalanzVariants = esD
        ? [tickerBase + 'O', tickerBase]
        : [ticker];

      let analyticsRaw: any = null;
      let datosBono: any = null;
      let tickerBalanzUsado = tickerBase;

      for (const tbv of tickerBalanzVariants) {
        try {
          let db: any = null;
          try { db = await balanzGet(`/datosBono/${tbv}/${hoy}`); } catch {}
          const ar = await balanzGet(
            `/flujoIndicadores/${tbv}/${hoy}/1/Dirty/${moneda}/${mep}/0/0/0/x/100`
          );
          const flujosTmp = parsearFlujoBalanz(ar.flujo || db?.flujo || []);
          if (flujosTmp.length > 0) {
            analyticsRaw = ar;
            datosBono = db;
            tickerBalanzUsado = tbv;
            break;
          }
        } catch {}
      }

      if (analyticsRaw) {
        const cupon = Array.isArray(analyticsRaw.cupon) ? analyticsRaw.cupon[0] : null;
        const laminaLey = Array.isArray(analyticsRaw.laminaLey) ? analyticsRaw.laminaLey[0] : null;
        const flujos = parsearFlujoBalanz(analyticsRaw.flujo || datosBono?.flujo || []);
        const indicadores = parsearIndicadoresBalanz(analyticsRaw.indicadores || []);

        if (flujos.length > 0) {
          const iolData = token ? await getIOLPrecio(token, ticker) : null;
          const precioValor = iolData?.ultimoPrecio ?? null;

          let tirFinal = indicadores?.tir ?? null;
          const precioUSD = precioValor ? (esD ? precioValor : precioValor / mep) : null;
          if (!tirFinal && precioUSD && flujos.length > 0) {
            tirFinal = calcularTIR(precioUSD, flujos);
          }

          const spec = buscarBono(tickerBalanzUsado) || buscarBono(ticker);
          let localAnal: any = null;
          if (spec && precioUSD) localAnal = getAnalytics(spec, precioUSD);

          return NextResponse.json({
            ticker,
            tipo: 'renta_fija',
            fuente: 'Balanz',
            enBaseDeDatos: true,
            monedaLabel,
            spec: {
              nombre: cupon?.obtenercupon || ticker,
              moneda: monedaLabel,
              ley: laminaLey?.ley === 'NY' ? 'nueva_york' : 'argentina',
              tasaCupon: cupon?.cuponval ? parseFloat(cupon.cuponval) : (spec?.tasaCupon ?? null),
              cuponDesc: cupon?.cupondesc || null,
              laminaMinima: laminaLey?.laminaminima ? parseInt(laminaLey.laminaminima) : null,
              vencimiento: spec?.vencimiento ?? null,
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
              duration: indicadores?.duration ?? localAnal?.duration ?? null,
              durationMod: indicadores?.durationMod ?? localAnal?.durationMod ?? null,
              paridad: indicadores?.paridad ?? localAnal?.paridad ?? null,
              precioDirty: indicadores?.precioDirty ?? localAnal?.precioDirty ?? null,
              precioClean: indicadores?.precioClean ?? localAnal?.precioClean ?? null,
              interesCorreido: indicadores?.interesCorreido ?? localAnal?.interesCorreido ?? null,
              pvbp: indicadores?.pvbp ?? localAnal?.pvbp ?? null,
              flujos,
              cantFlujos: flujos.length,
              proximoPago: flujos[0] || null,
            },
          });
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
        console.warn('Balanz cookie expirada');
      }
    }
  }

  // ── 2. BASE LOCAL + IOL ───────────────────────────────────
  const tickerBase = esD ? ticker.slice(0, -1) : ticker;
  const spec = buscarBono(tickerBase) || buscarBono(ticker);
  if (spec) {
    const mep = await getMep();
    const iolData = token
      ? (await getIOLPrecio(token, ticker) || await getIOLPrecio(token, tickerBase))
      : null;
    const precioValor = iolData?.ultimoPrecio ?? null;
    if (precioValor) {
      const precioUSD = esD ? precioValor : precioValor / mep;
      const anal = getAnalytics(spec, precioUSD);
      return NextResponse.json({
        ticker, tipo: 'renta_fija', fuente: 'Base local',
        enBaseDeDatos: true, monedaLabel,
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

  // ── 3. IOL BÁSICO ────────────────────────────────────────
  if (token) {
    const iolRaw = await getIOLPrecio(token, ticker);
    if (iolRaw?.ultimoPrecio) {
      const desc = iolRaw.descripcionTitulo || iolRaw.titulo?.descripcion || '';
      const esCedearARS = desc.toLowerCase().includes('cedear');

      if (esCedearARS && !esD) {
        const usTicker = getUSTicker(ticker);
        const fundamentals = await getYahooDetails(usTicker, '');
        return NextResponse.json({
          ticker, tipo: 'cedear', fuente: 'IOL ARS',
          monedaLabel: 'ARS',
          nombre: desc,
          precio: {
            valor: iolRaw.ultimoPrecio, moneda: 'ARS',
            variacion: iolRaw.variacion ?? null,
            apertura: iolRaw.apertura ?? null,
            maximo: iolRaw.maximo ?? null,
            minimo: iolRaw.minimo ?? null,
            cierreAnterior: iolRaw.cierreAnterior ?? null,
            fechaHora: iolRaw.fechaHora ?? null,
            fuente: 'IOL ARS',
          },
          marketCap: fundamentals?.marketCap ?? null,
          per: fundamentals?.per ?? null,
          eps: fundamentals?.eps ?? null,
          beta: fundamentals?.beta ?? null,
          maximo52: fundamentals?.maximo52 ?? null,
          minimo52: fundamentals?.minimo52 ?? null,
        });
      }

      if (!esCedearARS) {
        return NextResponse.json({
          ticker, tipo: 'renta_fija', fuente: 'IOL básico',
          enBaseDeDatos: false, monedaLabel,
          spec: { nombre: desc, vencimiento: parsearVto(desc), moneda: monedaLabel, esAprox: true },
          precio: { valor: iolRaw.ultimoPrecio, moneda: monedaLabel, variacion: iolRaw.variacion ?? null, fechaHora: iolRaw.fechaHora ?? null, fuente: 'IOL' },
          analytics: null, requiereSpecs: true,
        });
      }
    }
  }

  // ── 4. CEDEAR D ──────────────────────────────────────────
  if (esD) {
    const base = ticker.slice(0, -1);
    const usTicker = getUSTicker(base);
    const iolD = token ? await getIOLPrecio(token, ticker) : null;
    const precioCedear = iolD?.ultimoPrecio ?? null;
    const fundamentals = await getYahooDetails(usTicker, '');

    if (precioCedear || fundamentals) {
      return NextResponse.json({
        ticker, tipo: 'cedear', fuente: 'IOL D',
        monedaLabel: 'USD',
        nombre: fundamentals?.nombre || base,
        precio: {
          valor: precioCedear, moneda: 'USD',
          variacion: iolD?.variacion ?? null,
          apertura: iolD?.apertura ?? null,
          maximo: iolD?.maximo ?? null,
          minimo: iolD?.minimo ?? null,
          cierreAnterior: iolD?.cierreAnterior ?? null,
          fechaHora: iolD?.fechaHora ?? null,
          fuente: 'IOL D',
        },
        marketCap: fundamentals?.marketCap ?? null,
        per: fundamentals?.per ?? null,
        eps: fundamentals?.eps ?? null,
        beta: fundamentals?.beta ?? null,
        maximo52: fundamentals?.maximo52 ?? null,
        minimo52: fundamentals?.minimo52 ?? null,
      });
    }
  }

  // ── 5. RENTA VARIABLE ─────────────────────────────────────
  const detailsAR = await getYahooDetails(ticker, '.BA');
  if (detailsAR?.precio) return NextResponse.json({ ...detailsAR, tipo: 'renta_variable' });

  const detailsUS = await getYahooDetails(ticker, '');
  if (detailsUS?.precio) return NextResponse.json({ ...detailsUS, tipo: 'renta_variable' });

  return NextResponse.json({ error: `"${ticker}" no encontrado` }, { status: 404 });
}

import { NextRequest, NextResponse } from 'next/server';
import { buscarBono, getAnalytics, calcularTIR } from '@/lib/bonos';
import { balanzGet, parsearFlujoBalanz, parsearIndicadoresBalanz, getMep } from '@/lib/balanz';
import { getIOLToken, getIOLCotizacion, getIOLAsset, esCedear, esBono } from '@/lib/iol';

const ARS_TERMINAN_EN_D = new Set(['YPFD']);

const CEDEAR_A_US: Record<string, string> = {
  'GOGL': 'GOOGL', 'BRKB': 'BRK-B', 'DISN': 'DIS',
  'GOLD': 'GOLD', 'YPFD': 'YPF', 'GLD': 'GLD',
};
function getUSTicker(base: string): string {
  return CEDEAR_A_US[base] || base;
}

// Solo para renta variable US (step 5) y warm-up. Timeout 7s.
async function getYahooDetails(ticker: string, suffix: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const url = `${process.env.APPS_SCRIPT_URL}?action=details&ticker=${ticker}&suffix=${encodeURIComponent(suffix)}`;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data?.precio != null && !data.error) return data;
  } catch {}
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
  const token = await getIOLToken();

  // ── 1. BALANZ ─────────────────────────────────────────────
  if (process.env.BALANZ_COOKIE) {
    try {
      const moneda = esD ? 'Dolares' : 'Pesos';
      const hoy = new Date().toISOString().split('T')[0];
      const mep = await getMep();
      const tickerBase = esD ? ticker.slice(0, -1) : ticker;
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
            analyticsRaw = ar; datosBono = db; tickerBalanzUsado = tbv; break;
          }
        } catch {}
      }

      if (analyticsRaw) {
        const cupon = Array.isArray(analyticsRaw.cupon) ? analyticsRaw.cupon[0] : null;
        const laminaLey = Array.isArray(analyticsRaw.laminaLey) ? analyticsRaw.laminaLey[0] : null;
        const flujos = parsearFlujoBalanz(analyticsRaw.flujo || datosBono?.flujo || []);
        const indicadores = parsearIndicadoresBalanz(analyticsRaw.indicadores || []);

        if (flujos.length > 0) {
          const iolData = token ? await getIOLCotizacion(token, ticker) : null;
          const precioValor = iolData?.ultimoPrecio ?? null;
          let tirFinal = indicadores?.tir ?? null;
          const precioUSD = precioValor ? (esD ? precioValor : precioValor / mep) : null;
          if (!tirFinal && precioUSD) tirFinal = calcularTIR(precioUSD, flujos);
          const spec = buscarBono(tickerBalanzUsado) || buscarBono(ticker);
          let localAnal: any = null;
          if (spec && precioUSD) localAnal = getAnalytics(spec, precioUSD);

          return NextResponse.json({
            ticker, tipo: 'renta_fija', fuente: 'Balanz',
            enBaseDeDatos: true, monedaLabel,
            spec: {
              nombre: cupon?.obtenercupon || ticker, moneda: monedaLabel,
              ley: laminaLey?.ley === 'NY' ? 'nueva_york' : 'argentina',
              tasaCupon: cupon?.cuponval ? parseFloat(cupon.cuponval) : (spec?.tasaCupon ?? null),
              cuponDesc: cupon?.cupondesc || null,
              laminaMinima: laminaLey?.laminaminima ? parseInt(laminaLey.laminaminima) : null,
              vencimiento: spec?.vencimiento ?? null, esAprox: false,
            },
            precio: {
              valor: precioValor, moneda: monedaLabel,
              variacion: iolData?.variacion ?? null, apertura: iolData?.apertura ?? null,
              maximo: iolData?.maximo ?? null, minimo: iolData?.minimo ?? null,
              cierreAnterior: iolData?.cierreAnterior ?? null,
              fechaHora: iolData?.fechaHora ?? null, fuente: `IOL (${monedaLabel})`,
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
              flujos, cantFlujos: flujos.length, proximoPago: flujos[0] || null,
            },
          });
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'AUTH_EXPIRED') console.warn('Balanz cookie expirada');
    }
  }

  // ── 2. BASE LOCAL + IOL ───────────────────────────────────
  const tickerBase = esD ? ticker.slice(0, -1) : ticker;
  const spec = buscarBono(tickerBase) || buscarBono(ticker);
  if (spec) {
    const mep = await getMep();
    const iolData = token
      ? (await getIOLCotizacion(token, ticker) || await getIOLCotizacion(token, tickerBase))
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
          variacion: iolData?.variacion ?? null, apertura: iolData?.apertura ?? null,
          maximo: iolData?.maximo ?? null, minimo: iolData?.minimo ?? null,
          fechaHora: iolData?.fechaHora ?? null, fuente: `IOL (${monedaLabel})`,
        },
        analytics: anal,
      });
    }
  }

  // ── 3. IOL BÁSICO ────────────────────────────────────────
  if (token) {
    const iolRaw = await getIOLCotizacion(token, ticker);
    if (iolRaw?.ultimoPrecio) {
      // La cotización nueva ya no trae una descripción de texto del instrumento (la
      // API vieja sí, y clasificábamos "es CEDEAR"/"es bono" buscando palabras ahí
      // dentro). Ahora consultamos el catálogo de activos, que da un asset_type real.
      const tickerBaseAsset = esD ? ticker.slice(0, -1) : ticker;
      const asset = await getIOLAsset(token, tickerBaseAsset);
      const nombre = asset?.nombre || ticker;
      const esCedearARS = esCedear(asset?.assetType ?? null);

      // CEDEAR ARS — precio de IOL, fundamentals lazy desde /api/fundamentals
      if (esCedearARS && !esD) {
        const usTicker = getUSTicker(ticker);
        return NextResponse.json({
          ticker, tipo: 'cedear', fuente: 'IOL ARS',
          monedaLabel: 'ARS', nombre,
          usTicker, sufixFundamentals: '',
          precio: {
            valor: iolRaw.ultimoPrecio, moneda: 'ARS',
            variacion: iolRaw.variacion ?? null, apertura: iolRaw.apertura ?? null,
            maximo: iolRaw.maximo ?? null, minimo: iolRaw.minimo ?? null,
            cierreAnterior: iolRaw.cierreAnterior ?? null,
            fechaHora: iolRaw.fechaHora ?? null, fuente: 'IOL ARS',
          },
          marketCap: null, per: null, eps: null, beta: null,
          maximo52: null, minimo52: null,
        });
      }

      // Acción AR (ej: YPFD) — sin lazy fundamentals (GOOGLEFINANCE no los tiene para BYMA)
      if (!esCedearARS && !esBono(asset?.assetType ?? null)) {
        return NextResponse.json({
          ticker, tipo: 'renta_variable', fuente: 'IOL',
          nombre,
          // Sin usTicker → el hook no llama a /api/fundamentals
          precio: iolRaw.ultimoPrecio,
          variacion: iolRaw.variacion ?? null,
          apertura: iolRaw.apertura ?? null,
          maximo: iolRaw.maximo ?? null,
          minimo: iolRaw.minimo ?? null,
          cierreAnterior: iolRaw.cierreAnterior ?? null,
          fechaHora: iolRaw.fechaHora ?? null,
          marketCap: null, per: null, eps: null, beta: null,
          maximo52: null, minimo52: null,
        });
      }

      // Bono IOL básico
      if (!esCedearARS) {
        return NextResponse.json({
          ticker, tipo: 'renta_fija', fuente: 'IOL básico',
          enBaseDeDatos: false, monedaLabel,
          spec: { nombre, vencimiento: parsearVto(nombre), moneda: monedaLabel, esAprox: true },
          precio: { valor: iolRaw.ultimoPrecio, moneda: monedaLabel, variacion: iolRaw.variacion ?? null, fechaHora: iolRaw.fechaHora ?? null, fuente: 'IOL' },
          analytics: null, requiereSpecs: true,
        });
      }
    }
  }

  // ── 4. CEDEAR D — la línea "D" (dólares) de IOL no trae bien el cambio diario,
  // así que pedimos la línea base en pesos (confiable) y dejamos que el cliente la
  // convierta a USD con el MEP, igual que con cualquier otra CEDEAR en pesos.
  if (esD) {
    const base = ticker.slice(0, -1);
    const usTicker = getUSTicker(base);
    const iolBase = token ? await getIOLCotizacion(token, base) : null;
    const precioCedear = iolBase?.ultimoPrecio ?? null;

    if (precioCedear != null) {
      return NextResponse.json({
        ticker, tipo: 'cedear', fuente: 'IOL ARS',
        monedaLabel: 'ARS', nombre: usTicker,
        usTicker, sufixFundamentals: '',
        precio: {
          valor: precioCedear, moneda: 'ARS',
          variacion: iolBase?.variacion ?? null, apertura: iolBase?.apertura ?? null,
          maximo: iolBase?.maximo ?? null, minimo: iolBase?.minimo ?? null,
          cierreAnterior: iolBase?.cierreAnterior ?? null,
          fechaHora: iolBase?.fechaHora ?? null, fuente: 'IOL ARS',
        },
        marketCap: null, per: null, eps: null, beta: null,
        maximo52: null, minimo52: null,
      });
    }
  }

  // ── 5. RENTA VARIABLE US (necesita Apps Script para precio) ─
  const detailsAR = await getYahooDetails(ticker, '.BA');
  if (detailsAR?.precio) return NextResponse.json({ ...detailsAR, tipo: 'renta_variable' });

  const detailsUS = await getYahooDetails(ticker, '');
  if (detailsUS?.precio) return NextResponse.json({ ...detailsUS, tipo: 'renta_variable' });

  return NextResponse.json({ error: `"${ticker}" no encontrado` }, { status: 404 });
}

// ── Cliente de la API de IOL (api.iolinversiones.com) ───────────────────────
// IOL dio de baja la API vieja (api.invertironline.com/api/v2) y migró a esta.
// Centralizado acá para no repetir el login y el desarmado del sobre
// {data, meta, error} en cada ruta que lo necesita.

const IOL_API = 'https://api.iolinversiones.com';

export async function getIOLToken(): Promise<string | null> {
  try {
    const res = await fetch(`${IOL_API}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: process.env.IOL_USERNAME,
        password: process.env.IOL_PASSWORD,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.access_token ?? null;
  } catch { return null; }
}

async function iolGet(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${IOL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? null;
  } catch { return null; }
}

export interface IOLCotizacion {
  ultimoPrecio: number | null;
  variacion: number | null;
  apertura: number | null;
  maximo: number | null;
  minimo: number | null;
  cierreAnterior: number | null;
  cantidadOperada: number | null;
  fechaHora: string | null;
}

// Misma forma "plana" que devolvía la API vieja (v2), para no reescribir toda la
// lógica que ya consume estos campos en los distintos endpoints propios.
//
// Pedimos los dos segmentos de liquidación (T0 "contado inmediato" y T1 "normal") y nos
// quedamos con el que tenga la cotización más reciente: algunos activos casi no operan
// en uno de los dos segmentos y quedan con un precio de varios días atrás si solo
// consultamos ese.
export async function getIOLCotizacion(token: string, ticker: string, market = 'BCBA'): Promise<IOLCotizacion | null> {
  const [t0, t1] = await Promise.all([
    iolGet(`/broker/market-data/${encodeURIComponent(ticker)}/quote?market=${market}&term=T0`, token),
    iolGet(`/broker/market-data/${encodeURIComponent(ticker)}/quote?market=${market}&term=T1`, token),
  ]);
  const data = [t0, t1]
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const da = a?.last_updated ? new Date(a.last_updated).getTime() : 0;
      const db = b?.last_updated ? new Date(b.last_updated).getTime() : 0;
      return db - da;
    })[0];
  if (!data) return null;
  return {
    ultimoPrecio: data.prices?.current ?? null,
    variacion: data.change?.percent ?? null,
    apertura: data.prices?.open ?? null,
    maximo: data.prices?.high ?? null,
    minimo: data.prices?.low ?? null,
    cierreAnterior: data.prices?.previous_close ?? null,
    cantidadOperada: data.volume?.shares ?? null,
    fechaHora: data.last_updated ?? null,
  };
}

export interface IOLAsset {
  nombre: string | null;
  assetType: string | null;
}

// La cotización nueva ya no trae una descripción de texto del instrumento (la API
// vieja sí, y el código clasificaba "es CEDEAR"/"es bono" buscando palabras ahí
// dentro). Acá consultamos el catálogo de activos, que da un asset_type explícito.
export async function getIOLAsset(token: string, ticker: string, market = 'BCBA'): Promise<IOLAsset | null> {
  const data = await iolGet(`/broker/assets/${encodeURIComponent(ticker)}?market=${market}`, token);
  if (!data) return null;
  return { nombre: data.name ?? null, assetType: data.asset_type ?? null };
}

// IOL devuelve asset_type en mayúsculas (ej. "CEDEARS"), por eso comparamos en minúsculas.
export function esCedear(assetType: string | null): boolean {
  return (assetType || '').toLowerCase() === 'cedears';
}

export function esBono(assetType: string | null): boolean {
  const t = (assetType || '').toLowerCase();
  return t === 'government_bonds' || t === 'ons' || t === 'letters';
}

export interface IOLBar {
  fecha: string;
  cierre: number;
  apertura: number | null;
  maximo: number | null;
  minimo: number | null;
  volumen: number | null;
}

// Serie histórica diaria. La API vieja tomaba fechas yyyy-MM-dd directamente; la nueva
// pide "yyyy-MM-dd HH:mm:ss", así que completamos el rango horario del día.
export async function getIOLHistorico(
  token: string, ticker: string, fechaDesde: string, fechaHasta: string, market = 'BCBA'
): Promise<IOLBar[]> {
  const from = encodeURIComponent(`${fechaDesde} 00:00:00`);
  const to = encodeURIComponent(`${fechaHasta} 23:59:59`);
  const data = await iolGet(`/broker/market-data/${encodeURIComponent(ticker)}/bars?market=${market}&from=${from}&to=${to}`, token);
  const bars = data?.bars;
  if (!Array.isArray(bars)) return [];
  return bars
    .map((b: any): IOLBar | null => {
      const fecha = (typeof b.datetime === 'string' ? b.datetime.split('T')[0] : null)
        ?? (typeof b.timestamp === 'number' ? new Date(b.timestamp * 1000).toISOString().split('T')[0] : null);
      if (!fecha || b.close == null) return null;
      return { fecha, cierre: b.close, apertura: b.open ?? null, maximo: b.high ?? null, minimo: b.low ?? null, volumen: b.volume ?? null };
    })
    .filter((b: IOLBar | null): b is IOLBar => b !== null)
    .sort((a: IOLBar, b: IOLBar) => a.fecha.localeCompare(b.fecha));
}

// Paneles disponibles para un tipo de activo (ej: listar los paneles de acciones AR).
export async function getIOLPanels(token: string, country: 'AR' | 'US', assetType: string): Promise<any[]> {
  const data = await iolGet(`/broker/assets/panels?country=${country}&asset_type=${encodeURIComponent(assetType)}`, token);
  return Array.isArray(data) ? data : [];
}

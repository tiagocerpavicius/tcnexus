import type { FlujoPago } from './types';

const BASE = 'https://calculadora.balanz.com/calculadoraDeBonos';

export function balanzHeaders() {
  return {
    'Cookie': process.env.BALANZ_COOKIE!,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'es-419,es-US;q=0.9,es;q=0.8',
    'Referer': 'https://calculadora.balanz.com/calculadoraDeBonos/calculadoraBonos',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };
}

export async function balanzGet(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: balanzHeaders() });
  if (res.status === 401 || res.status === 403) throw new Error('AUTH_EXPIRED');
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

export function parsearFlujoBalanz(flujos: any[]): FlujoPago[] {
  if (!Array.isArray(flujos)) return [];
  return flujos
    .filter((f: any) => f && f.fecha)
    .map((f: any) => {
      const interes = parseFloat(f.cupon ?? f.interes ?? f.renta ?? f.intereses ?? 0);
      const amort = parseFloat(f.amortizacion ?? f.capital ?? f.amort ?? 0);
      return {
        fecha: f.fecha,
        interes: +interes.toFixed(4),
        amortizacion: +amort.toFixed(4),
        total: +(interes + amort).toFixed(4),
      };
    })
    .filter(f => f.total > 0);
}

export function parsearIndicadoresBalanz(indicadores: any[]) {
  if (!Array.isArray(indicadores) || !indicadores.length) return null;
  const ind = indicadores[0];
  const get = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = ind[k];
      if (v != null && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) !== 0) return +parseFloat(v).toFixed(4);
    }
    return null;
  };
  return {
    tir: get('tir', 'TIR', 'rendimiento', 'tasa_retorno'),
    duration: get('duration', 'duracion', 'Duration'),
    durationMod: get('mduration', 'duracion_modificada', 'duration_mod', 'mduracion'),
    paridad: get('paridad', 'Paridad'),
    precioDirty: get('precio_sucio', 'preciodirty', 'PrecioDirty'),
    precioClean: get('precio_limpio', 'precioclean', 'PrecioClean'),
    interesCorreido: get('intereses_corridos', 'interes_corrido', 'intcorrido'),
    pvbp: get('pvbp', 'PVBP', 'dv01'),
    raw: ind,
  };
}

export async function getMep(): Promise<number> {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/bolsa');
    const data = await res.json();
    return data?.venta || 1430;
  } catch { return 1430; }
}

// ── Normalización de tickers ────────────────────────────────────────────────
// Fuente única para agrupar operaciones del mismo activo bajo una sola clave,
// sin importar si se cargaron con el ticker en pesos (CEDEAR/acción local) o
// en dólares. Usado tanto en el cliente (portfolio) como en las rutas de API
// (reportes) — mantenerlo centralizado evita que la lógica diverja entre
// archivos, que es justo lo que causaba tenencias/rendimientos duplicados.

// CEDEARs cuyo ticker base en pesos (ya sin la "D" de liquidación) no coincide
// con el ticker real en dólares del subyacente (asignado por BYMA), ej:
// Alphabet cotiza como GOGL/GOGLD en BYMA, no GOOGL/GOOGLD.
export const CEDEAR_BASE_A_US: Record<string, string> = {
  GOGL: 'GOOGL',
  BRKB: 'BRK-B',
  DISN: 'DIS',
};

// Inversa de CEDEAR_BASE_A_US, para reconstruir el ticker de búsqueda en pesos
// a partir del ticker normalizado en dólares.
const US_A_CEDEAR_BASE: Record<string, string> = Object.fromEntries(
  Object.entries(CEDEAR_BASE_A_US).map(([base, us]) => [us, base])
);

// Tickers cuyo símbolo termina en "D" de forma nativa (no es el sufijo de
// liquidación en pesos de un CEDEAR) — no hay que quitarles la D al
// normalizar. Algunos representan el mismo activo que otro ticker (ej: YPFD
// en BYMA es la misma acción que el ADR YPF en NYSE) y se mapean directamente
// a ese ticker para consolidar la tenencia.
export const TICKER_D_NATIVO: Record<string, string> = {
  YPFD: 'YPF',
  NDD: 'NDD',
  GLD: 'GLD',
  GOLD: 'GOLD',
};

export function normalizarTicker(ticker: string): string {
  const upper = ticker.toUpperCase().trim();
  if (TICKER_D_NATIVO[upper]) return TICKER_D_NATIVO[upper];
  if (upper.endsWith('D') && upper.length > 2) {
    const base = upper.slice(0, -1);
    return CEDEAR_BASE_A_US[base] || base;
  }
  return upper;
}

// Dado un ticker ya normalizado (en dólares), reconstruye el ticker con el
// que hay que buscar la cotización de la CEDEAR en pesos (ej: GOOGL → GOGLD).
export function tickerParaBuscarCedear(tickerNormalizado: string): string {
  const base = US_A_CEDEAR_BASE[tickerNormalizado] || tickerNormalizado;
  return base + 'D';
}

// Dado un ticker ya normalizado, reconstruye el ticker local/BYMA original
// cuando difiere del normalizado (ej: YPF → YPFD). Para el resto, es la
// identidad.
export function tickerLocalArs(tickerNormalizado: string): string {
  const entry = Object.entries(TICKER_D_NATIVO).find(([, v]) => v === tickerNormalizado);
  return entry ? entry[0] : tickerNormalizado;
}

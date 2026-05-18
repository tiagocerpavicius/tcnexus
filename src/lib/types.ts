export type Moneda = 'USD' | 'ARS' | 'USD_linked';
export type Ley = 'argentina' | 'nueva_york' | 'otro';
export type TipoBono = 'soberano' | 'provincial' | 'ON';

export interface Cotizacion {
  ticker: string;
  precio: number | null;
  variacion: number | null;
  apertura?: number | null;
  maximo?: number | null;
  minimo?: number | null;
  volumen?: number | null;
}

export interface DolarRate {
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
}

export interface Noticia {
  id: string;
  titulo: string;
  resumen: string;
  fuente: string;
  url: string;
  fecha: string;
  tickers: string[];
  imagen: string | null;
}

export interface FlujoPago {
  fecha: string;
  interes: number;
  amortizacion: number;
  total: number;
  vnVigente?: number;
}

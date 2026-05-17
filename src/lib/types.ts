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

export interface Operacion {
  id: string;
  fecha: string;
  ticker: string;
  nombre?: string;
  tipo: 'COMPRA' | 'VENTA' | 'DIVIDENDO';
  cantidad: number;
  precio: number;
  monto: number;
  moneda: string;
  broker?: string;
  comision: number;
  notas?: string;
  importacion_id?: string;
}

export interface Caucion {
  id: string;
  descripcion: string;
  monto: number;
  tna: number;
  plazo: number;
  fecha_inicio: string;
  renovaciones: number;
}

export interface CaucionPeriodo {
  id: string;
  caucion_id: string;
  monto: number;
  tna: number;
  plazo: number;
  fecha_inicio: string;
  intereses: number;
}

export interface CedearArb {
  id: string;
  ticker: string;
  cantidad: number;
  precio_compra: number;
  precio_actual: number;
  precio_venta?: number;
  fecha_venta?: string;
}

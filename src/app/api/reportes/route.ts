import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizarTicker, tickerParaBuscarCedear, tickerLocalArs } from '@/lib/tickers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getFechaInicio(periodo: string, fechaCustomInicio?: string): string {
  if (periodo === 'custom' && fechaCustomInicio) return fechaCustomInicio;
  const hoy = new Date();
  const map: Record<string, number> = {
    diario: 1, semanal: 7, mensual: 30, anual: 365, historico: 365 * 10,
  };
  const dias = map[periodo] ?? 30;
  hoy.setDate(hoy.getDate() - dias);
  return hoy.toISOString().split('T')[0];
}

function tickerParaBuscar(ticker: string, tipoActivo: string): string {
  const upper = ticker.toUpperCase();
  if (upper.endsWith('D')) return upper;
  if (tipoActivo === 'accion_ar') return tickerLocalArs(upper);
  if (tipoActivo === 'bono' || tipoActivo === 'efectivo') return upper;
  if (tipoActivo === 'cedear') return tickerParaBuscarCedear(upper);
  return upper;
}

export async function POST(request: NextRequest) {
  try {
    const { user_id, periodo, fechaCustomInicio, fechaCustomFin } = await request.json();
    if (!user_id) return NextResponse.json({ error: 'user_id requerido' }, { status: 400 });

    // MEP actual
    let mep = 1430;
    try {
      const dolarRes = await fetch('https://dolarapi.com/v1/dolares/bolsa');
      const dolarData = await dolarRes.json();
      const bolsa = Array.isArray(dolarData) ? dolarData.find((d: any) => d.casa === 'bolsa') : dolarData;
      if (bolsa?.venta) mep = bolsa.venta;
      else if (typeof dolarData?.venta === 'number') mep = dolarData.venta;
    } catch {}

    const fechaInicio = getFechaInicio(periodo, fechaCustomInicio);
    const fechaFin = fechaCustomFin || new Date().toISOString().split('T')[0];

    // 1. Operaciones
    const { data: ops, error: opsError } = await supabase
      .from('operaciones')
      .select('*')
      .eq('user_id', user_id)
      .lte('fecha', fechaFin)
      .order('fecha', { ascending: true });

    if (opsError) throw opsError;
    if (!ops?.length) return NextResponse.json({ error: 'Sin operaciones' }, { status: 404 });

    // 2. Cauciones
    const { data: cauciones } = await supabase
      .from('cauciones')
      .select('*')
      .eq('user_id', user_id);

    const { data: periodosCauciones } = await supabase
      .from('caucion_periodos')
      .select('*')
      .eq('user_id', user_id);

    // 3. Capital inicial
    const depositos = ops.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const retiros = ops.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const capitalInicial = depositos - retiros;

    // 4. Ops del período
    const opsPeriodo = ops.filter(o => o.fecha >= fechaInicio && o.fecha <= fechaFin);
    const depositosPeriodo = opsPeriodo.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const retirosPeriodo = opsPeriodo.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);

    // 5. Posiciones — single pass cronológico
    const transferCostPerUnit = new Map<string, number>();
    const posiciones = new Map<string, {
      cantidad: number; costoTotal: number; tipo: string; broker: string; moneda: string;
    }>();

    // Ganancias realizadas por ticker (para activos comprados y vendidos por completo)
    const realizadas = new Map<string, {
      costoRealizado: number; montoVenta: number; cantidadVendida: number; fechaUltimaVenta: string;
    }>();

    // Eventos (compra/venta/dividendo) por ticker, para reconstruir en el cliente cuánto
    // había invertido y cuánto se había realizado en cada fecha (curva día a día exacta,
    // no solo el total final).
    const eventosPorTicker = new Map<string, { fecha: string; tipo: 'compra' | 'venta' | 'dividendo'; cantidad: number; montoUsd: number }[]>();
    const pushEvento = (key: string, ev: { fecha: string; tipo: 'compra' | 'venta' | 'dividendo'; cantidad: number; montoUsd: number }) => {
      if (!eventosPorTicker.has(key)) eventosPorTicker.set(key, []);
      eventosPorTicker.get(key)!.push(ev);
    };

    // Mapa de primera compra por ticker
    const primeraCompraPorTicker: Record<string, string> = {};

    const sorted = [...ops].sort((a, b) => {
      const d = a.fecha.localeCompare(b.fecha);
      if (d !== 0) return d;
      if (a.tipo === 'traspaso' && b.tipo === 'traspaso') {
        if (a.notas === 'out' && b.notas === 'in') return -1;
        if (a.notas === 'in' && b.notas === 'out') return 1;
      }
      return 0;
    });

    for (const op of sorted) {
      const t = op.ticker?.toUpperCase();
      if (!t || op.tipo === 'deposito' || op.tipo === 'retiro' || op.tipo === 'dividendo') continue;
      const key = normalizarTicker(t);

      // Registrar primera compra
      if (op.tipo === 'compra' && !primeraCompraPorTicker[key]) {
        primeraCompraPorTicker[key] = op.fecha;
      }

      if (!posiciones.has(key)) {
        posiciones.set(key, {
          cantidad: 0, costoTotal: 0,
          tipo: op.tipo_activo || 'cedear',
          broker: op.broker || '',
          moneda: op.moneda || 'ARS',
        });
      }
      const pos = posiciones.get(key)!;

      // Solo trackeamos eventos día a día para tipos con precio de mercado consultable
      // (cedear/accion_ar) — bonos/efectivo no tienen historial de precio en este reporte.
      const trackeable = pos.tipo === 'cedear' || pos.tipo === 'accion_ar';

      if (op.tipo === 'compra') {
        pos.cantidad += op.cantidad || 0;
        pos.costoTotal += op.monto_usd || 0;
        pos.broker = op.broker || pos.broker;
        if (trackeable) pushEvento(key, { fecha: op.fecha, tipo: 'compra', cantidad: op.cantidad || 0, montoUsd: op.monto_usd || 0 });
      } else if (op.tipo === 'venta' && pos.cantidad > 0) {
        const pct = Math.min((op.cantidad || 0) / pos.cantidad, 1);
        const costoVendido = pos.costoTotal * pct;
        pos.costoTotal -= costoVendido;
        pos.cantidad -= op.cantidad || 0;
        if (pos.cantidad <= 0) { pos.cantidad = 0; pos.costoTotal = 0; }

        // Amortizaciones de renta fija son devolución de capital, no ganancia realizada
        if (op.notas !== 'amortizacion') {
          if (!realizadas.has(key)) realizadas.set(key, { costoRealizado: 0, montoVenta: 0, cantidadVendida: 0, fechaUltimaVenta: op.fecha });
          const r = realizadas.get(key)!;
          r.costoRealizado += costoVendido;
          r.montoVenta += op.monto_usd || 0;
          r.cantidadVendida += op.cantidad || 0;
          r.fechaUltimaVenta = op.fecha;
          if (trackeable) pushEvento(key, { fecha: op.fecha, tipo: 'venta', cantidad: op.cantidad || 0, montoUsd: op.monto_usd || 0 });
        }
      } else if (op.tipo === 'traspaso' && op.notas === 'out' && pos.cantidad > 0) {
        const qty = Math.min(op.cantidad || 0, pos.cantidad);
        const costPerUnit = pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0;
        transferCostPerUnit.set(key, costPerUnit);
        const pct = qty / pos.cantidad;
        pos.costoTotal *= (1 - pct);
        pos.cantidad -= qty;
        if (pos.cantidad <= 0) { pos.cantidad = 0; pos.costoTotal = 0; }
      } else if (op.tipo === 'traspaso' && op.notas === 'in') {
        const qty = op.cantidad || 0;
        const costPerUnit = transferCostPerUnit.get(key) || 0;
        pos.cantidad += qty;
        pos.costoTotal += costPerUnit * qty;
        pos.broker = op.broker || pos.broker;
      }
    }

    // 6. Dividendos
    const dividendosPeriodo = opsPeriodo
      .filter(o => o.tipo === 'dividendo')
      .reduce((s, o) => s + (o.monto_usd || 0), 0);

    const dividendosPorTicker: Record<string, number> = {};
    ops.filter(o => o.tipo === 'dividendo').forEach(o => {
      if (o.ticker) {
        const key = normalizarTicker(o.ticker);
        dividendosPorTicker[key] = (dividendosPorTicker[key] || 0) + (o.monto_usd || 0);
        const tipoPos = posiciones.get(key)?.tipo;
        if (tipoPos === 'cedear' || tipoPos === 'accion_ar') {
          pushEvento(key, { fecha: o.fecha, tipo: 'dividendo', cantidad: 0, montoUsd: o.monto_usd || 0 });
        }
      }
    });

    // Los dividendos se agregaron después del pase cronológico principal — reordenamos
    eventosPorTicker.forEach(lista => lista.sort((a, b) => a.fecha.localeCompare(b.fecha)));

    // 7. Performance por activo (posiciones abiertas)
    const performancePorActivo = Array.from(posiciones.entries())
      .filter(([, v]) => v.cantidad > 0.0001)
      .map(([ticker, pos]) => ({
        ticker,
        tickerBuscar: tickerParaBuscar(ticker, pos.tipo),
        cantidad: pos.cantidad,
        costoTotal: pos.costoTotal,
        costoPromedio: pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0,
        dividendos: dividendosPorTicker[ticker] || 0,
        tipo: pos.tipo,
        broker: pos.broker,
        fechaPrimeraCompra: primeraCompraPorTicker[ticker] || null,
        eventos: eventosPorTicker.get(ticker) || [],
      }));

    // 7b. Activos comprados y vendidos por completo, cerrados dentro del período del reporte
    const performanceCerrada = Array.from(posiciones.entries())
      .filter(([ticker, v]) => v.cantidad <= 0.0001 && realizadas.has(ticker))
      .map(([ticker, pos]) => {
        const r = realizadas.get(ticker)!;
        const gananciaUSD = r.montoVenta - r.costoRealizado;
        return {
          ticker,
          tickerBuscar: tickerParaBuscar(ticker, pos.tipo),
          tipo: pos.tipo,
          broker: pos.broker,
          cantidadVendida: r.cantidadVendida,
          costoRealizado: r.costoRealizado,
          montoVenta: r.montoVenta,
          gananciaUSD,
          gananciaPct: r.costoRealizado > 0 ? (gananciaUSD / r.costoRealizado) * 100 : 0,
          dividendos: dividendosPorTicker[ticker] || 0,
          fechaPrimeraCompra: primeraCompraPorTicker[ticker] || null,
          fechaUltimaVenta: r.fechaUltimaVenta,
          eventos: eventosPorTicker.get(ticker) || [],
        };
      })
      .filter(p => p.fechaUltimaVenta >= fechaInicio && p.fechaUltimaVenta <= fechaFin);

    // 8. Cauciones
    const interesesCauciones = (periodosCauciones || []).reduce((s, p) => s + (p.intereses || 0), 0);
    const capitalCaucionado = (cauciones || []).reduce((s, c) => s + (c.monto || 0), 0);
    const tnasValidas = (cauciones || []).filter((c: any) => c.tna).map((c: any) => c.tna);
    const tnaPromedio = tnasValidas.length
      ? tnasValidas.reduce((a: number, b: number) => a + b, 0) / tnasValidas.length
      : null;

    // 9. Efectivo
    let efectivoUSD = 0;
    for (const op of ops) {
      if (op.tipo === 'deposito') efectivoUSD += op.monto_usd || 0;
      else if (op.tipo === 'retiro') efectivoUSD -= op.monto_usd || 0;
      else if (op.tipo === 'compra') efectivoUSD -= op.monto_usd || 0;
      else if (op.tipo === 'venta') efectivoUSD += op.monto_usd || 0;
      else if (op.tipo === 'dividendo') efectivoUSD += op.monto_usd || 0;
    }
    efectivoUSD = Math.max(0, efectivoUSD);

    // Nota: la volatilidad, el Max Drawdown y el gráfico de evolución se calculan en el
    // cliente (reportes/page.tsx) a partir del valor de mercado histórico de las posiciones
    // (precio × cantidad), no acá — acá no tenemos precios históricos por activo, y calcular
    // esas métricas sobre depósitos/extracciones no mide el rendimiento real del portfolio.

    return NextResponse.json({
      periodo,
      fechaInicio,
      fechaFin,
      mep,
      capitalInicial,
      depositosPeriodo,
      retirosPeriodo,
      dividendosPeriodo,
      capitalCaucionado,
      interesesCauciones,
      tnaPromedio,
      efectivoUSD,
      tickersAbiertos: performancePorActivo.map(p => p.tickerBuscar),
      performancePorActivo,
      performanceCerrada,
      totalOps: ops.length,
      opsPeriodoCount: opsPeriodo.length,
    });

  } catch (err) {
    console.error('reportes error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

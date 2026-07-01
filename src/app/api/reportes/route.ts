import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function calcularRetornos(h: { fecha: string; cierre: number }[]) {
  return h.slice(1).map((d, i) => (d.cierre - h[i].cierre) / h[i].cierre);
}

function calcularVolatilidad(h: { fecha: string; cierre: number }[]): number | null {
  if (h.length < 10) return null;
  const r = calcularRetornos(h);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return +(Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / r.length) * Math.sqrt(252) * 100).toFixed(2);
}

function calcularMaxDrawdown(capitalPorFecha: { fecha: string; valor: number }[]): number {
  if (capitalPorFecha.length < 2) return 0;
  let maxDD = 0;
  let peak = capitalPorFecha[0].valor;
  for (const { valor } of capitalPorFecha) {
    if (valor > peak) peak = valor;
    const dd = (valor - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }
  return +maxDD.toFixed(2);
}

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
  if (tipoActivo === 'bono' || tipoActivo === 'accion_ar' || tipoActivo === 'efectivo') return upper;
  if (tipoActivo === 'cedear') return upper + 'D';
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
      const key = t.endsWith('D') && t.length > 2 ? t.slice(0, -1) : t;

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

      if (op.tipo === 'compra') {
        pos.cantidad += op.cantidad || 0;
        pos.costoTotal += op.monto_usd || 0;
        pos.broker = op.broker || pos.broker;
      } else if (op.tipo === 'venta' && pos.cantidad > 0) {
        const pct = Math.min((op.cantidad || 0) / pos.cantidad, 1);
        pos.costoTotal *= (1 - pct);
        pos.cantidad -= op.cantidad || 0;
        if (pos.cantidad <= 0) { pos.cantidad = 0; pos.costoTotal = 0; }
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
        const key = o.ticker.toUpperCase().endsWith('D')
          ? o.ticker.toUpperCase().slice(0, -1)
          : o.ticker.toUpperCase();
        dividendosPorTicker[key] = (dividendosPorTicker[key] || 0) + (o.monto_usd || 0);
      }
    });

    // 7. Performance por activo
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
      }));

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

    // 10. Historial de capital
    let acumDepositos = 0;
    const historialCapital: { fecha: string; valor: number }[] = [];
    const fechasUnicas = Array.from(new Set(ops.map(o => o.fecha))).sort();
    for (const fecha of fechasUnicas) {
      if (fecha < fechaInicio || fecha > fechaFin) continue;
      const opsDia = ops.filter(o => o.fecha === fecha);
      acumDepositos += opsDia.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
      acumDepositos -= opsDia.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);
      if (acumDepositos > 0) historialCapital.push({ fecha, valor: acumDepositos });
    }

    // 11. Métricas de riesgo
    const volatilidad = calcularVolatilidad(
      historialCapital.map(h => ({ fecha: h.fecha, cierre: h.valor }))
    );
    const maxDrawdown = calcularMaxDrawdown(historialCapital);

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
      historialCapital,
      volatilidad,
      maxDrawdown,
      totalOps: ops.length,
      opsPeriodoCount: opsPeriodo.length,
    });

  } catch (err) {
    console.error('reportes error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

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

function calcularSharpe(retornoPct: number, volatilidad: number | null): number | null {
  if (!volatilidad || volatilidad === 0) return null;
  const rf = 4.5; // Risk-free rate aproximado
  return +((retornoPct - rf) / volatilidad).toFixed(2);
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

export async function POST(request: NextRequest) {
  try {
    const { user_id, periodo, fechaCustomInicio, fechaCustomFin } = await request.json();
    if (!user_id) return NextResponse.json({ error: 'user_id requerido' }, { status: 400 });

    const fechaInicio = getFechaInicio(periodo, fechaCustomInicio);
    const fechaFin = fechaCustomFin || new Date().toISOString().split('T')[0];

    // 1. Traer todas las operaciones del usuario hasta fechaFin
    const { data: ops, error: opsError } = await supabase
      .from('operaciones')
      .select('*')
      .eq('user_id', user_id)
      .lte('fecha', fechaFin)
      .order('fecha', { ascending: true });

    if (opsError) throw opsError;
    if (!ops?.length) return NextResponse.json({ error: 'Sin operaciones' }, { status: 404 });

    // 2. Traer cauciones del usuario
    const { data: cauciones } = await supabase
      .from('cauciones')
      .select('*')
      .eq('user_id', user_id);

    const { data: periodosCauciones } = await supabase
      .from('caucion_periodos')
      .select('*')
      .eq('user_id', user_id);

    // 3. Calcular capital inicial (depósitos netos históricos)
    const depositos = ops.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const retiros = ops.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const capitalInicial = depositos - retiros;

    // 4. Calcular depósitos/retiros dentro del período
    const opsPeriodo = ops.filter(o => o.fecha >= fechaInicio && o.fecha <= fechaFin);
    const depositosPeriodo = opsPeriodo.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
    const retirosPeriodo = opsPeriodo.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);

    // 5. Calcular posiciones abiertas al cierre del período
    const posiciones = new Map<string, { cantidad: number; costoTotal: number; tipo: string; broker: string }>();
    for (const op of ops) {
      const t = op.ticker;
      if (!t || op.tipo === 'deposito' || op.tipo === 'retiro' || op.tipo === 'dividendo') continue;
      if (!posiciones.has(t)) posiciones.set(t, { cantidad: 0, costoTotal: 0, tipo: op.tipo_activo || 'renta_variable', broker: op.broker || '' });
      const pos = posiciones.get(t)!;
      if (op.tipo === 'compra' || (op.tipo === 'traspaso' && op.notas === 'in')) {
        pos.cantidad += op.cantidad || 0;
        pos.costoTotal += op.monto_usd || 0;
      } else if (op.tipo === 'venta' || (op.tipo === 'traspaso' && op.notas === 'out')) {
        const costoUnit = pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0;
        pos.cantidad -= op.cantidad || 0;
        pos.costoTotal -= costoUnit * (op.cantidad || 0);
        if (pos.cantidad <= 0) { pos.cantidad = 0; pos.costoTotal = 0; }
      }
    }

    // 6. Tickers con posición abierta
    const tickersAbiertos = Array.from(posiciones.entries())
      .filter(([, v]) => v.cantidad > 0)
      .map(([ticker]) => ticker);

    // 7. Dividendos del período
    const dividendosPeriodo = opsPeriodo
      .filter(o => o.tipo === 'dividendo')
      .reduce((s, o) => s + (o.monto_usd || 0), 0);

    // 8. Dividendos por ticker
    const dividendosPorTicker: Record<string, number> = {};
    ops.filter(o => o.tipo === 'dividendo').forEach(o => {
      if (o.ticker) dividendosPorTicker[o.ticker] = (dividendosPorTicker[o.ticker] || 0) + (o.monto_usd || 0);
    });

    // 9. P&L realizado del período (ventas)
    const ventasPeriodo = opsPeriodo.filter(o => o.tipo === 'venta');
    let plRealizado = 0;
    for (const venta of ventasPeriodo) {
      const pos = posiciones.get(venta.ticker);
      if (pos && pos.cantidad > 0) {
        const costoUnit = pos.costoTotal / pos.cantidad;
        plRealizado += (venta.monto_usd || 0) - costoUnit * (venta.cantidad || 0);
      }
    }

    // 10. Cauciones — métricas del período
    const interesesCauciones = (periodosCauciones || []).reduce((s, p) => s + (p.intereses || 0), 0);
    const capitalCaucionado = (cauciones || []).reduce((s, c) => s + (c.monto || 0), 0);
    const tnasValidas = (cauciones || []).filter(c => c.tna).map(c => c.tna);
    const tnaPromedio = tnasValidas.length ? tnasValidas.reduce((a, b) => a + b, 0) / tnasValidas.length : null;

    // 11. Historial de capital por fecha (usando ops acumuladas)
    const fechasUnicas = Array.from(new Set(ops.map(o => o.fecha))).sort();
    let acumDepositos = 0;
    const historialCapital: { fecha: string; valor: number }[] = [];
    for (const fecha of fechasUnicas) {
      if (fecha < fechaInicio || fecha > fechaFin) continue;
      const opsDia = ops.filter(o => o.fecha === fecha);
      acumDepositos += opsDia.filter(o => o.tipo === 'deposito').reduce((s, o) => s + (o.monto_usd || 0), 0);
      acumDepositos -= opsDia.filter(o => o.tipo === 'retiro').reduce((s, o) => s + (o.monto_usd || 0), 0);
      historialCapital.push({ fecha, valor: acumDepositos });
    }

    // 12. Retornos mensuales (últimos 12 meses)
    const retornosMensuales: { mes: string; retorno: number | null }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      retornosMensuales.push({ mes, retorno: null }); // se completará con precios reales en el frontend
    }

    // 13. Performance por activo (P&L precio + rentas)
    const performancePorActivo = Array.from(posiciones.entries())
      .filter(([, v]) => v.cantidad > 0)
      .map(([ticker, pos]) => ({
        ticker,
        cantidad: pos.cantidad,
        costoTotal: pos.costoTotal,
        costoPromedio: pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0,
        dividendos: dividendosPorTicker[ticker] || 0,
        tipo: pos.tipo,
        broker: pos.broker,
      }));

    // 14. Exposición sectorial — los tickers se enriquecen en el frontend con /api/ticker-sector
    const exposicionSectorial: Record<string, number> = {};

    // 15. Métricas de riesgo básicas
    const volatilidad = calcularVolatilidad(historialCapital.map(h => ({ fecha: h.fecha, cierre: h.valor })));
    const maxDrawdown = calcularMaxDrawdown(historialCapital);

    return NextResponse.json({
      periodo,
      fechaInicio,
      fechaFin,
      // Capital
      capitalInicial,
      depositosPeriodo,
      retirosPeriodo,
      dividendosPeriodo,
      plRealizado,
      // Cauciones
      capitalCaucionado,
      interesesCauciones,
      tnaPromedio,
      // Posiciones
      tickersAbiertos,
      performancePorActivo,
      exposicionSectorial,
      // Historial
      historialCapital,
      retornosMensuales,
      // Riesgo
      volatilidad,
      maxDrawdown,
      // Meta
      totalOps: ops.length,
      opsPeriodoCount: opsPeriodo.length,
    });

  } catch (err) {
    console.error('reportes error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

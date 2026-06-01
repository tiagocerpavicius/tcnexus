import { NextRequest, NextResponse } from 'next/server';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const {
      periodo, fechaInicio, fechaFin, capitalInicial, capitalActual,
      retornoPeriodo, volatilidad, maxDrawdown, sharpe,
      performancePorActivo, exposicionSectorial,
      capitalCaucionado, interesesCauciones, tnaPromedio,
      dividendosPeriodo,
    } = await request.json();

    // Ordenar activos por rendimiento del período
    const activosOrdenados = [...(performancePorActivo || [])]
      .sort((a: any, b: any) => (b.retPeriodo ?? b.plPctTotal ?? 0) - (a.retPeriodo ?? a.plPctTotal ?? 0));

    const mejores = activosOrdenados.slice(0, 3);
    const peores = [...activosOrdenados].reverse().slice(0, 3);

    // Calcular concentración
    const totalValor = (performancePorActivo || []).reduce((s: number, a: any) => s + (a.costoTotal || 0), 0);
    const concentracion = activosOrdenados.slice(0, 3).reduce((s: number, a: any) => s + (a.costoTotal || 0), 0) / (totalValor || 1) * 100;

    // Sector dominante
    const sectorDominante = Object.entries(exposicionSectorial || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))[0];

    const sectorStr = Object.entries(exposicionSectorial || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([s, p]) => `${s}: ${(p as number).toFixed(1)}%`)
      .join(', ');

    // Detalle de activos con rendimiento real
    const activosStr = (performancePorActivo || [])
      .sort((a: any, b: any) => (b.retPeriodo ?? b.plPctTotal ?? 0) - (a.retPeriodo ?? a.plPctTotal ?? 0))
      .map((a: any) => {
        const ret = a.retPeriodo != null
          ? (a.retPeriodo > 0 ? '+' : '') + a.retPeriodo.toFixed(2) + '%'
          : (a.plPctTotal != null ? (a.plPctTotal > 0 ? '+' : '') + a.plPctTotal.toFixed(2) + '%' : '—');
        const plTotal = a.plTotal != null
          ? (a.plTotal >= 0 ? '+' : '') + 'USD ' + Math.abs(a.plTotal).toFixed(0)
          : '—';
        const valor = a.valorActual != null ? 'USD ' + a.valorActual.toFixed(0) : '—';
        return `${a.ticker}: rendimiento período ${ret}, P&L total ${plTotal}, valor actual ${valor}, dividendos USD ${a.dividendos?.toFixed(2) || '0'}`;
      })
      .join('\n');

    const mejoresStr = mejores
      .map((a: any) => {
        const ret = a.retPeriodo != null ? (a.retPeriodo > 0 ? '+' : '') + a.retPeriodo.toFixed(2) + '%' : '—';
        return `${a.ticker} (${ret})`;
      })
      .join(', ');

    const peoresStr = peores
      .map((a: any) => {
        const ret = a.retPeriodo != null ? (a.retPeriodo > 0 ? '+' : '') + a.retPeriodo.toFixed(2) + '%' : '—';
        return `${a.ticker} (${ret})`;
      })
      .join(', ');

    const gananciaNeta = capitalActual && capitalInicial ? capitalActual - capitalInicial : null;

    const contexto = `
PERÍODO: ${periodo} (${fechaInicio} → ${fechaFin})

MÉTRICAS DE RENDIMIENTO:
- Retorno del período: ${retornoPeriodo != null ? (retornoPeriodo > 0 ? '+' : '') + retornoPeriodo.toFixed(2) + '%' : 'No disponible'}
- Capital inicial: USD ${capitalInicial?.toLocaleString('en-US', { minimumFractionDigits: 0 }) ?? '—'}
- Capital actual: USD ${capitalActual?.toLocaleString('en-US', { minimumFractionDigits: 0 }) ?? '—'}
- Ganancia/Pérdida neta: USD ${gananciaNeta != null ? (gananciaNeta >= 0 ? '+' : '') + gananciaNeta.toFixed(0) : '—'}
- Dividendos cobrados: USD ${dividendosPeriodo?.toFixed(2) ?? '0'}

MÉTRICAS DE RIESGO:
- Volatilidad anualizada: ${volatilidad != null ? volatilidad.toFixed(1) + '%' : '—'}
- Max Drawdown: ${maxDrawdown != null ? maxDrawdown.toFixed(2) + '%' : '—'}
- Sharpe Ratio: ${sharpe != null ? sharpe.toFixed(2) : '—'}
- Concentración top 3: ${concentracion.toFixed(1)}%

EXPOSICIÓN SECTORIAL:
${sectorStr}
Sector dominante: ${sectorDominante ? `${sectorDominante[0]} (${(sectorDominante[1] as number).toFixed(1)}%)` : '—'}

DETALLE DE POSICIONES (ordenadas por rendimiento del período):
${activosStr}

MEJORES DEL PERÍODO: ${mejoresStr}
PEORES DEL PERÍODO: ${peoresStr}

CAUCIONES:
- Capital caucionado: USD ${capitalCaucionado?.toLocaleString('en-US') ?? '0'}
- Intereses devengados: USD ${interesesCauciones?.toFixed(2) ?? '0'}
- TNA promedio: ${tnaPromedio != null ? tnaPromedio.toFixed(1) + '%' : '—'}
`.trim();

    const prompt = `Sos un asesor financiero senior de Wealth Management especializado en el mercado argentino y global. Tu análisis debe ser profundo, específico y de alto valor para inversores de grandes capitales. No uses lenguaje genérico — cada observación debe estar anclada en los datos concretos del portfolio.

DATOS DEL PORTFOLIO:
${contexto}

INSTRUCCIONES IMPORTANTES:
- Usá tu conocimiento actualizado del contexto macroeconómico argentino y global para el período analizado
- Referenciá activos específicos del portfolio con sus datos REALES de rendimiento (los que figuran arriba)
- Los "mejores" y "peores" son exactamente los que figuran en MEJORES DEL PERÍODO y PEORES DEL PERÍODO
- Identificá patrones, correlaciones y riesgos concretos basados en los números reales
- Las recomendaciones deben ser accionables y específicas para ESTE portfolio
- El tono debe ser profesional pero claro, como un asesor hablando directamente con su cliente
- Incluí contexto de mercado relevante para el período (política monetaria, geopolítica, sector tech, commodities, Argentina macro)
- NUNCA inventes rendimientos ni confundas qué activo fue mejor o peor — usá los datos que te doy

Respondé ÚNICAMENTE con un JSON válido con esta estructura (sin markdown ni texto fuera del JSON):
{
  "resumen_ejecutivo": "Párrafo de 4-5 oraciones describiendo específicamente qué pasó con ESTE portfolio en el período, mencionando los activos con mejor y peor rendimiento con sus números reales, y cuál es la conclusión principal.",
  "contexto_mercado": "Párrafo de 3-4 oraciones sobre el contexto macroeconómico y de mercado del período que afectó directamente a este portfolio. Mencioná sectores específicos, política monetaria Fed/BCRA, geopolítica, o lo que sea relevante para este período.",
  "analisis_rendimiento": "Párrafo de 3-4 oraciones analizando el retorno obtenido. Mencioná los activos específicos que más aportaron y los que más restaron, con sus rendimientos reales del período. Explicá por qué dado el contexto.",
  "analisis_riesgo": "Párrafo de 3 oraciones evaluando la relación riesgo/retorno, concentración sectorial, volatilidad y drawdown. Señalá si el nivel de riesgo es adecuado.",
  "analisis_concentracion": "Párrafo de 2-3 oraciones sobre la concentración del portfolio. ¿Está bien diversificado? ¿Hay exposición excesiva a algún sector o activo? ¿Qué riesgo implica?",
  "cauciones": "Párrafo de 2 oraciones sobre el aporte de las cauciones al rendimiento total. null si no hay cauciones.",
  "oportunidades": [
    "Oportunidad concreta 1 identificada en base a la composición actual y el contexto de mercado — mencioná tickers o sectores específicos",
    "Oportunidad concreta 2",
    "Oportunidad concreta 3"
  ],
  "recomendaciones": [
    "Recomendación específica y accionable 1 — con ticker o sector concreto cuando aplique",
    "Recomendación específica y accionable 2",
    "Recomendación específica y accionable 3",
    "Recomendación específica y accionable 4"
  ],
  "alertas": [
    "Alerta concreta sobre un riesgo real identificado en el portfolio con números específicos",
    "Alerta 2 si aplica"
  ],
  "sesgo": "Alcista | Neutral | Bajista",
  "confianza": "Alta | Media | Baja"
}`;

    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq error:', err);
      return NextResponse.json({ error: 'Groq API error' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: 'Invalid AI response' }, { status: 500 });

    const analisis = JSON.parse(jsonMatch[0]);
    return NextResponse.json(analisis);

  } catch (err) {
    console.error('ai-reporte error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

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

    // Ordenar activos por rendimiento
    const activosOrdenados = [...(performancePorActivo || [])]
      .sort((a: any, b: any) => (b.plPct || 0) - (a.plPct || 0));
    const mejores = activosOrdenados.slice(0, 3);
    const peores = activosOrdenados.slice(-3).reverse();

    // Calcular concentración
    const totalValor = (performancePorActivo || []).reduce((s: number, a: any) => s + (a.costoTotal || 0), 0);
    const concentracion = activosOrdenados.slice(0, 3).reduce((s: number, a: any) => s + (a.costoTotal || 0), 0) / totalValor * 100;

    // Sector dominante
    const sectorDominante = Object.entries(exposicionSectorial || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))[0];

    const sectorStr = Object.entries(exposicionSectorial || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([s, p]) => `${s}: ${(p as number).toFixed(1)}%`)
      .join(', ');

    const activosStr = (performancePorActivo || [])
      .map((a: any) => `${a.ticker}: costo USD ${a.costoTotal?.toFixed(0)}, cantidad ${a.cantidad?.toFixed(0)}, dividendos USD ${a.dividendos?.toFixed(2) || '0'}`)
      .join('\n');

    const mejoresStr = mejores.map((a: any) => `${a.ticker}`).join(', ');
    const peoresStr = peores.map((a: any) => `${a.ticker}`).join(', ');

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

POSICIONES:
${activosStr}

MEJORES ACTIVOS DEL PERÍODO: ${mejoresStr}
PEORES ACTIVOS DEL PERÍODO: ${peoresStr}

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
- Referenciá activos específicos del portfolio con sus datos reales
- Identificá patrones, correlaciones y riesgos concretos
- Las recomendaciones deben ser accionables y específicas para ESTE portfolio
- El tono debe ser profesional pero claro, como un asesor hablando directamente con su cliente
- Incluí contexto de mercado relevante para el período (política monetaria, geopolítica, sector tech, commodities, Argentina macro)

Respondé ÚNICAMENTE con un JSON válido con esta estructura (sin markdown ni texto fuera del JSON):
{
  "resumen_ejecutivo": "Párrafo de 4-5 oraciones describiendo específicamente qué pasó con ESTE portfolio en el período, qué lo impulsó o lo frenó, y cuál es la conclusión principal. Mencioná activos concretos y números reales.",
  "contexto_mercado": "Párrafo de 3-4 oraciones sobre el contexto macroeconómico y de mercado del período que afectó directamente a este portfolio. Mencioná sectores específicos, política monetaria Fed/BCRA, geopolítica, o lo que sea relevante.",
  "analisis_rendimiento": "Párrafo de 3-4 oraciones analizando el retorno obtenido con los activos específicos del portfolio. Explicá qué activos aportaron más, cuáles restaron, y por qué dado el contexto de mercado.",
  "analisis_riesgo": "Párrafo de 3 oraciones evaluando la relación riesgo/retorno, concentración sectorial, volatilidad y drawdown. Señalá si el nivel de riesgo es adecuado para el tipo de cartera.",
  "analisis_concentracion": "Párrafo de 2-3 oraciones sobre la concentración del portfolio. ¿Está bien diversificado? ¿Hay exposición excesiva a algún sector o activo? ¿Qué riesgo implica eso?",
  "cauciones": "Párrafo de 2 oraciones sobre el aporte de las cauciones al rendimiento total y si la estrategia de renta fija está bien calibrada para el contexto actual. null si no hay cauciones.",
  "oportunidades": [
    "Oportunidad concreta 1 identificada en base a la composición actual del portfolio y el contexto de mercado",
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
    "Alerta concreta sobre un riesgo real identificado en el portfolio",
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

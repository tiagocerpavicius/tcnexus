import { NextRequest, NextResponse } from 'next/server';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const { periodo, fechaInicio, fechaFin, capitalInicial, capitalActual, retornoPeriodo, retornoTotal, volatilidad, maxDrawdown, sharpe, performancePorActivo, exposicionSectorial, capitalCaucionado, interesesCauciones, tnaPromedio, dividendosPeriodo, benchmarks } = await request.json();

    const topActivos = [...(performancePorActivo || [])]
      .sort((a, b) => (b.plPct || 0) - (a.plPct || 0))
      .slice(0, 8);

    const sectorStr = Object.entries(exposicionSectorial || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([s, p]) => `${s}: ${(p as number).toFixed(1)}%`)
      .join(', ');

    const benchStr = benchmarks
      ? Object.entries(benchmarks).map(([k, v]) => `${k}: ${v}%`).join(' | ')
      : 'No disponible';

    const contexto = `
PERÍODO ANALIZADO: ${periodo} (${fechaInicio} → ${fechaFin})

MÉTRICAS PRINCIPALES:
- Capital inicial del período: USD ${capitalInicial?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '—'}
- Capital actual estimado: USD ${capitalActual?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '—'}
- Retorno del período: ${retornoPeriodo != null ? (retornoPeriodo > 0 ? '+' : '') + retornoPeriodo.toFixed(2) + '%' : '—'}
- Retorno total acumulado: ${retornoTotal != null ? (retornoTotal > 0 ? '+' : '') + retornoTotal.toFixed(2) + '%' : '—'}
- Dividendos cobrados: USD ${dividendosPeriodo?.toFixed(2) ?? '0'}

MÉTRICAS DE RIESGO:
- Volatilidad anualizada: ${volatilidad != null ? volatilidad.toFixed(1) + '%' : '—'}
- Max Drawdown: ${maxDrawdown != null ? maxDrawdown.toFixed(2) + '%' : '—'}
- Sharpe Ratio: ${sharpe != null ? sharpe.toFixed(2) : '—'}

COMPARACIÓN VS BENCHMARKS:
${benchStr}

EXPOSICIÓN SECTORIAL:
${sectorStr || 'No disponible'}

POSICIONES (mejores y peores del período):
${topActivos.map(a => `${a.ticker}: costo USD ${a.costoTotal?.toFixed(2) ?? '—'}, cantidad ${a.cantidad}, dividendos USD ${a.dividendos?.toFixed(2) ?? '0'}`).join('\n')}

CAUCIONES:
- Capital caucionado: USD ${capitalCaucionado?.toLocaleString('en-US') ?? '0'}
- Intereses devengados: USD ${interesesCauciones?.toFixed(2) ?? '0'}
- TNA promedio: ${tnaPromedio != null ? tnaPromedio.toFixed(1) + '%' : '—'}
`.trim();

    const prompt = `Sos un analista financiero senior de Wealth Management especializado en mercados globales y argentinos. Tu tarea es generar un análisis profesional del rendimiento del portfolio para el período indicado.

DATOS DEL PORTFOLIO:
${contexto}

Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta (sin markdown ni texto fuera del JSON):
{
  "resumen_ejecutivo": "Párrafo de 3-4 oraciones resumiendo el desempeño del período, contexto de mercado y conclusión general",
  "analisis_rendimiento": "Párrafo de 2-3 oraciones analizando el retorno obtenido, comparándolo con benchmarks si están disponibles y explicando los principales drivers",
  "analisis_riesgo": "Párrafo de 2 oraciones evaluando la relación riesgo/retorno, volatilidad y drawdown del período",
  "cauciones": "Párrafo de 1-2 oraciones sobre el aporte de las cauciones al rendimiento total si hay datos, o null si no hay cauciones",
  "recomendaciones": [
    "Recomendación concreta y accionable 1 para el próximo período",
    "Recomendación concreta y accionable 2",
    "Recomendación concreta y accionable 3"
  ],
  "alertas": [
    "Alerta o riesgo a monitorear 1 (puede ser vacío si no hay alertas relevantes)",
    "Alerta o riesgo a monitorear 2"
  ],
  "sesgo": "Alcista | Neutral | Bajista",
  "confianza": "Alta | Media | Baja"
}

Reglas:
- Tono profesional para inversores de alto patrimonio
- Recomendaciones prácticas y específicas al portfolio
- Si el retorno es negativo, analizá si es coyuntural o estructural
- Considerá el contexto macroeconómico argentino y global en tu análisis
- Las alertas deben ser concretas, no genéricas`;

    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        max_tokens: 1500,
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

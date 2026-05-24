import { NextRequest, NextResponse } from 'next/server';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const { tickers } = await request.json();
    if (!tickers || !tickers.length) {
      return NextResponse.json({ error: 'Tickers requeridos' }, { status: 400 });
    }

    const contexto = tickers.map((t: any) => {
      const lineas = [
        `Ticker: ${t.ticker}`,
        t.nombre ? `Empresa: ${t.nombre}` : null,
        t.precio != null ? `Precio actual: $${t.precio}` : null,
        t.variacion != null ? `Variación diaria: ${t.variacion.toFixed(2)}%` : null,
        t.varMensual != null ? `Variación mensual: ${t.varMensual.toFixed(2)}%` : null,
        t.varAnual != null ? `Variación anual: ${t.varAnual.toFixed(2)}%` : null,
        t.marketCap != null ? `Capitalización bursátil: ${t.marketCap > 1e12 ? (t.marketCap/1e12).toFixed(2)+'T' : t.marketCap > 1e9 ? (t.marketCap/1e9).toFixed(2)+'B' : (t.marketCap/1e6).toFixed(2)+'M'} USD` : null,
        t.per != null ? `P/E Ratio: ${t.per.toFixed(2)}` : null,
        t.eps != null ? `EPS: $${t.eps.toFixed(2)}` : null,
        t.beta != null ? `Beta: ${t.beta.toFixed(2)}` : null,
        t.numAnalistas != null ? `Cobertura de analistas: ${t.numAnalistas} analistas (Compra fuerte: ${t.strongBuy}, Compra: ${t.buy}, Mantener: ${t.hold}, Venta: ${t.sell}, Venta fuerte: ${t.strongSell})` : null,
      ].filter(Boolean).join('\n');
      return lineas;
    }).join('\n\n---\n\n');

    const prompt = `Sos un analista financiero senior especializado en mercados globales y argentinos, con amplio conocimiento de empresas listadas en NYSE, NASDAQ y BCBA. Trabajás para un equipo de Wealth Management de alto nivel.

Tu tarea es generar un análisis profesional y detallado de los siguientes activos. Para cada empresa, usá tu conocimiento sobre el negocio, industria, posicionamiento competitivo y contexto macroeconómico actual.

DATOS DE MERCADO:
${contexto}

Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta (sin markdown ni texto fuera del JSON):
{
  "resumen_general": "Párrafo de 3-4 oraciones describiendo el conjunto de activos, el contexto de mercado actual y qué tipo de cartera representan",
  "analisis_empresas": [
    {
      "ticker": "XXX",
      "descripcion": "2-3 oraciones describiendo el negocio principal de la empresa, su modelo de ingresos y posición en la industria",
      "drivers": "1-2 oraciones sobre los principales catalizadores de crecimiento o riesgo actuales",
      "tesis": "1-2 oraciones con la tesis de inversión resumida"
    }
  ],
  "activo_destacado": {
    "ticker": "el ticker más interesante del grupo",
    "razon": "2-3 oraciones explicando por qué destaca, qué lo diferencia de los otros activos del grupo"
  },
  "insights": [
    "Insight 1: concreto, accionable y relevante para un asesor financiero",
    "Insight 2: puede ser sobre correlaciones entre activos, riesgos sectoriales o oportunidades",
    "Insight 3: enfocado en gestión de riesgo o diversificación del grupo"
  ],
  "ranking": [
    { "ticker": "XXX", "puntos": 85, "etiqueta": "Compra Fuerte" }
  ],
  "riesgo_general": "Bajo | Moderado | Alto",
  "sesgo_mercado": "Alcista | Neutral | Bajista"
}

Reglas importantes:
- El análisis_empresas debe incluir TODOS los tickers analizados
- El ranking debe incluir TODOS los tickers ordenados de mejor a peor (puntos de 0 a 100)
- Etiquetas del ranking: "Compra Fuerte", "Compra", "Mantener", "Reducir", "Venta"
- Usá tu conocimiento actualizado sobre cada empresa más allá de los datos provistos
- El tono debe ser profesional pero accesible para clientes de alto patrimonio
- Priorizá información práctica y accionable`;

    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 2000,
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
    console.error('ai-resumen error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

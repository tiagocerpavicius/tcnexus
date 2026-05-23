import { NextRequest, NextResponse } from 'next/server';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const { tickers } = await request.json();
    if (!tickers || !tickers.length) {
      return NextResponse.json({ error: 'Tickers requeridos' }, { status: 400 });
    }

    // Armar contexto con los datos de cada ticker
    const contexto = tickers.map((t: any) => {
      const lineas = [
        `Ticker: ${t.ticker}`,
        t.nombre ? `Nombre: ${t.nombre}` : null,
        t.precio != null ? `Precio actual: ${t.precio}` : null,
        t.variacion != null ? `Variación diaria: ${t.variacion.toFixed(2)}%` : null,
        t.varMensual != null ? `Variación mensual: ${t.varMensual.toFixed(2)}%` : null,
        t.varAnual != null ? `Variación anual: ${t.varAnual.toFixed(2)}%` : null,
        t.marketCap != null ? `Market Cap: ${t.marketCap}` : null,
        t.per != null ? `P/E Ratio: ${t.per}` : null,
        t.eps != null ? `EPS: ${t.eps}` : null,
        t.beta != null ? `Beta: ${t.beta}` : null,
        t.maximo52 != null ? `Máximo 52 semanas: ${t.maximo52}` : null,
        t.minimo52 != null ? `Mínimo 52 semanas: ${t.minimo52}` : null,
        t.numAnalistas != null ? `Analistas: ${t.numAnalistas} (strongBuy:${t.strongBuy} buy:${t.buy} hold:${t.hold} sell:${t.sell})` : null,
      ].filter(Boolean).join('\n');
      return lineas;
    }).join('\n\n---\n\n');

    const prompt = `Sos un analista financiero experto en mercados argentinos y globales. 
Analizá los siguientes activos y generá un resumen ejecutivo en español para un asesor de Wealth Management.

DATOS DE LOS ACTIVOS:
${contexto}

Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta (sin markdown, sin explicaciones fuera del JSON):
{
  "resumen_general": "párrafo corto describiendo el conjunto de activos seleccionados",
  "activo_destacado": {
    "ticker": "el ticker más interesante",
    "razon": "por qué destaca en 1-2 oraciones"
  },
  "insights": [
    "insight 1 concreto y accionable",
    "insight 2 concreto y accionable",
    "insight 3 concreto y accionable"
  ],
  "ranking": [
    { "ticker": "XXX", "puntos": 85, "etiqueta": "Compra Fuerte" },
    { "ticker": "YYY", "puntos": 62, "etiqueta": "Mantener" }
  ],
  "riesgo_general": "Bajo | Moderado | Alto",
  "sesgo_mercado": "Alcista | Neutral | Bajista"
}

El ranking debe incluir todos los tickers ordenados de mejor a peor según tu análisis (puntos de 0 a 100).
Etiquetas posibles: "Compra Fuerte", "Compra", "Mantener", "Reducir", "Venta".`;

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
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq error:', err);
      return NextResponse.json({ error: 'Groq API error' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parsear JSON de la respuesta
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: 'Invalid AI response' }, { status: 500 });

    const analisis = JSON.parse(jsonMatch[0]);
    return NextResponse.json(analisis);

  } catch (err) {
    console.error('ai-resumen error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

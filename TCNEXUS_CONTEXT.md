# TCNexus — Contexto Completo del Proyecto
*Última actualización: 30/05/2026*

---

## IDENTIDAD DEL USUARIO
- **Nombre**: Tiago Cerpavicius
- **Rol**: Asesor financiero de Wealth Management en IOL Inversiones
- **Clientes**: +400 clientes de grandes capitales
- **Actividades**: revisión de carteras, monitoreo, rotaciones, propuestas
- **Comunidad**: genera daily bursátil, comparte research, recomendaciones y novedades

---

## PROYECTO: TCNexus — Dashboard WM Personal

### Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind (mínimo), Recharts
- **Backend/DB**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **Repo**: `github.com/tiagoocerpavicius/tcnexus`
- **URL prod**: `tcnexus.vercel.app`
- **Supabase URL**: `https://qdzirbrqelrahkolxbmi.supabase.co`

### Design System (Dark Theme)
```css
--bg: #07070f
--surface: #0d0d1c
--surface2: #12122a
--violet: #7c3aed
--violet-light: #a78bfa
--green: #22c55e
--red: #f43f5e
--amber: #f59e0b
--text: #f1f5f9
--text2: #94a3b8
--muted: #475569
--muted2: #64748b
--border: rgba(148,163,184,0.1)
```
**Fuentes**: Syne (títulos/tickers), DM Sans (body), DM Mono (números)

---

## ARCHIVOS PRINCIPALES

| Archivo | Path en repo | Estado |
|---|---|---|
| Portfolio | `src/app/(app)/portfolio/page.tsx` | ✅ Completo (1389 líneas) |
| Dashboard | `src/app/(app)/dashboard/page.tsx` | ✅ Completo (657 líneas) |
| Cauciones | `src/app/(app)/cauciones/page.tsx` | ✅ (no se tiene copia local actualizada) |
| Mercado | `src/app/(app)/mercado/page.tsx` | ✅ (ya era responsive, no requirió cambios) |
| Layout | `src/app/(app)/layout.tsx` | ✅ Sidebar desktop / BottomNav mobile |
| BottomNav | `src/components/BottomNav.tsx` | ✅ |
| useIsMobile | `src/hooks/useIsMobile.ts` | ✅ breakpoint 768px |

---

## TABLAS SUPABASE

```sql
-- Operaciones del portfolio
operaciones (
  id uuid PRIMARY KEY,
  user_id uuid,
  fecha date,
  ticker text,
  nombre text,
  tipo text CHECK (tipo IN ('compra','venta','dividendo','deposito','retiro','traspaso')),
  cantidad numeric,
  precio_unitario numeric,
  monto_usd numeric,
  moneda text,
  tipo_activo text,
  broker text,
  notas text,  -- 'in' o 'out' para traspasos
  created_at timestamptz
)

-- Cauciones tomadoras
cauciones (
  id uuid PRIMARY KEY,
  user_id uuid,
  descripcion text,
  monto numeric,
  tna numeric,
  plazo integer,
  fecha_inicio date,
  renovaciones integer,
  moneda text  -- 'USD' o 'ARS'
)

-- Períodos de cada caución (para tracking de intereses)
caucion_periodos (
  id uuid PRIMARY KEY,
  caucion_id uuid REFERENCES cauciones(id),
  user_id uuid,
  monto numeric,
  tna numeric,
  plazo integer,
  fecha_inicio date,
  intereses numeric
)

-- Activos comprados con capital de cauciones
cedears_arb (
  id uuid PRIMARY KEY,
  user_id uuid,
  ticker text,
  tipo text,
  cantidad numeric,
  precio_compra numeric,
  precio_actual numeric,
  precio_venta numeric,
  fecha_venta date,
  moneda text  -- 'USD' o 'ARS'
)
```

---

## SECCIONES DE LA APP

### 1. Portfolio (`/portfolio`)
Vista principal del inversor. Tabs:
- **Resumen** 🎯 (default al entrar)
- **Posiciones** 📋
- **Mapa** 🗺️
- **Dist.** 🥧
- **Perf.** 🏆
- **Historial** 📈
- **Ops.** 📝

#### Tab Resumen
- 4 cards: Capital Total, Capital Inicial, Ganancia Total, Retorno Total
- Donut distribución por tipo de activo (incluyendo cauciones si las hay)
- Por estrategia: Portfolio / Cauciones USD / Cauciones ARS con barra de progreso
- Top 5 mejores y peores posiciones

#### Tab Posiciones
- Tabla completa con scroll horizontal (funciona en mobile también)
- Columna "Activo" sticky a la izquierda
- Columnas: Activo, Precio, Cant., Costo Prom., Valor Actual, **P&L Precio**, **P&L Rentas**, **P&L Total**, P&L%, Var.Hoy, Tipo, Broker
- Toggle ARS/USD
- Footer con totales de cada columna P&L

#### Cards del header
- Capital Actual (valor de mercado actual)
- Capital Inicial = depósitos netos (NO suma de compras)
- Ganancia Neta = Capital Actual - Capital Inicial
- TIR Anualizada = CAGR calculado sobre depósitos netos + incluyendo liquidez
- En Activos (valor de posiciones abiertas)
- Liquidez (efectivo)
- Concentración (top 3 tickers)
- Neto Cauciones USD / ARS
- Mejor y peor activo

### 2. Dashboard (`/dashboard`)
Comparador de activos. Tabs:
- Precios (tabla scrolleable con var. diaria, mensual, anual, volatilidad)
- Fundamentales (tabla scrolleable, columna izquierda sticky, verde = mejor)
- Correlación (matriz de correlación)
- Gráficos (líneas normalizadas, toggle de rangos y activos)
- Analistas (consenso y distribución de recomendaciones)
- Resumen IA (análisis generado por Claude API)

### 3. Mercado (`/mercado`)
Búsqueda y análisis de activos individuales. Ya responsive.

### 4. Cauciones (`/cauciones`)
- Tab Resumen: cards P&L No Realiz., P&L Realiz., P&L Total, Costo Cauciones, Rend. Neto
- Tab Cauciones: lista y gestión de cauciones tomadoras
- Tab Activos: CEDEARs comprados con capital caucionado (cedears_arb)

### 5. Noticias y Reportes
Aún no implementadas.

---

## ARQUITECTURA: IMPORTACIÓN DE OPERACIONES

### Flujo correcto
1. **Importar Balanz primero** (traspaso OUT se procesa antes)
2. **Importar IOL segundo** (traspaso IN hereda costo de Balanz)
3. NO importar compras que ya están en sección Cauciones (para evitar doble conteo)
4. MEP (AL30, GD30, etc.): ambos lados se importan y se cancelan entre sí → quedan en 0

### Tipos de operación soportados

**IOL parser** detecta:
- `Compra(TICKER)` → compra
- `Venta(TICKER)` → venta
- `Pago de Dividendos(TICKER)` → dividendo
- `Depósito de Fondos` → deposito (filtra las `Cancelada`)
- `Extracción de Fondos` → retiro
- `Transferencia de Titulos IN - (TICKER)` → traspaso, notas:'in'
- Cauciones (Caución Tomadora, Liquidación, etc.) → IGNORADAS (están en sección Cauciones)

**Balanz parser** detecta:
- Boleto COMPRA/VENTA → compra/venta
- Dividendo/Renta → dividendo
- `Transferencia Externa (Débito)` → traspaso, notas:'out'
- `Amortización / TICKER` → venta (vencimiento de letras)
- `Renta / TICKER`, `Renta y Amortización / TICKER` → dividendo
- `Recibo de Cobro / N` → deposito

### Normalización de tickers
```typescript
// Elimina sufijo D en CEDEARs (MSFTD → MSFT, NUD → NU)
// EXCEPCIONES (no normalizar): GD30, GD35, GD38, GD41, GD46, GD29, AL29, AL30, AL35, AL41, AE38, GGAL, PAMP, YPFD
function normalizarTicker(ticker: string): string
```

### Cálculo de posiciones (single-pass cronológico)
```typescript
// Orden: fecha ASC, con traspaso_out ANTES de traspaso_in el mismo día
// UNA SOLA PASADA (no dos pasadas)
// Los traspasos heredan el costo por unidad del broker origen
// Esto corrige el bug donde NFLX (y similares vendidos en IOL post-traspaso)
// quedaban como posición abierta con el enfoque de dos pasadas
function calcularPosicionesBase(ops: Operacion[]): Map<string, PosicionBase>
function calcularGananciasRealizadas(ops: Operacion[], vencimientosMap): GananciaRealizada[]
```

---

## MÉTRICAS CLAVE — CÓMO SE CALCULAN

| Métrica | Fórmula |
|---|---|
| Capital Actual | totalActivosUSD + efectivoUSD + netoCaucionesTotalUSD |
| Capital Inicial | sum(depositos) - sum(retiros) — NO suma de compras |
| Ganancia Neta | Capital Actual - Capital Inicial |
| Retorno % | Ganancia / Capital Inicial |
| TIR (CAGR) | (capitalActual / capitalInicial)^(1/años) - 1 — incluye efectivo |
| Efectivo | depositos - retiros - compras + ventas + dividendos (min 0) |
| P&L Precio | valorActualUSD - costoTotalUSD (por posición) |
| P&L Rentas | sum(dividendo ops para ese ticker) |
| P&L Total | P&L Precio + P&L Rentas |
| Historial "Invertido" | sum(depositos) - sum(retiros) acumulado por fecha |

---

## BUGS CORREGIDOS EN ESTA SESIÓN

| Bug | Causa | Fix |
|---|---|---|
| Total portfolio inflado ($23k vs $16k) | Traspasos no parseados → posiciones duplicadas + depósitos cancelados IOL importados | Fix parsers + reimport |
| NFLX (y similares) abierta después de vendida | Dos pasadas: venta procesada ANTES que traspaso IN | Una sola pasada cronológica |
| AL30 figuraba en tenencia (MEP) | Un lado del MEP no importado por tilde en "Dólares" | normCuenta() normaliza tildes en Tipo Cuenta |
| S15G5/S30S5 P&L = $0 | Amortización no parseada en Balanz | parseBalanz detecta "Amortización / TICKER" como venta |
| Capital Inicial inflado | Usaba suma de compras (incluye reinversiones) | Cambiado a depósitos netos |
| TIR negativa con retorno positivo | CAGR no sumaba liquidez al valorActual | Fix: totalActivos + efectivo |
| Gráfico historial "Invertido" inflado | Usaba suma de compras | Fix: depósitos acumulados netos |
| Tooltips ilegibles en charts | Falta color en contentStyle | Agregado color: 'var(--text)', itemStyle, labelStyle |
| Tablas se cortaban en mobile | Columnas ocultas con isMobile | Scroll horizontal con columna sticky |
| Error compile: duplicate TabPosiciones | str_replace dejó cuerpo viejo | Eliminado manualmente |
| DB error al importar traspaso | CHECK constraint no incluía 'traspaso' | SQL: ALTER TABLE operaciones ADD CONSTRAINT |

---

## DECISIONES DE ARQUITECTURA

- **Cauciones**: sección SEPARADA del portfolio — no se mezclan. En Portfolio solo activos financiados con capital propio.
- **Capital Inicial**: depósitos netos (no compras) para mostrar retorno real sobre capital propio
- **Traspasos**: heredan costo original del broker origen, sin impacto en efectivo
- **MEP**: compra + venta del mismo bono → se cancelan → posición = 0
- **Letras vencidas**: detectadas por ticker (S15G5, S30S5) → excluidas de posiciones activas
- **P&L dividido**: Precio + Rentas + Total (visible en Tab Posiciones, columnas separadas)
- **Tabla responsive**: scroll horizontal en lugar de ocultar columnas — columna izquierda sticky

---

## ESTADO ACTUAL DE LA APP

### Lo que funciona ✅
- Import desde IOL y Balanz con deduplicación
- Traspasos entre brokers con herencia de costo
- Amortizaciones de LECAPs/BONCAPs
- Cálculo P&L por precio y por rentas separados
- Tab Resumen consolidado (portfolio + cauciones)
- Historial de capital con gráfico correcto
- Dashboard comparativo con 6 tabs
- Cauciones con tracking de activos y P&L neto
- Responsive completo (mobile + desktop)
- Tooltips legibles en todos los gráficos

### Pendiente / No implementado ⏳
- Sección Noticias
- Sección Reportes
- Precios IOL caen frecuentemente (problema externo de la API)
- Cauciones page: tooltip fix manual pendiente de confirmar

---

## NOTAS SOBRE LA API DE IOL
La API de precios de IOL tiene caídas frecuentes. Cuando los precios no cargan, los activos muestran "—" en valor y P&L. Esto es un problema externo. La app funciona correctamente cuando la API responde.

---

## VARIABLES DE ENTORNO NECESARIAS
(No se tienen los valores exactos, están configurados en Vercel y Supabase)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY` (para el tab Resumen IA del Dashboard)

---

## PRÓXIMOS PASOS SUGERIDOS
1. Implementar sección **Noticias** (daily bursátil para la comunidad)
2. Implementar sección **Reportes** (generación de informes para clientes)
3. Verificar fix del tooltip en cauciones/page.tsx
4. Multi-usuario (actualmente la app es para uso personal del asesor)

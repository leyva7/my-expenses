# Mis Gastos: cómo está hecho y cómo cambiarlo sin romperlo

- **App:** `app/gastos.html` (v19). Es un único archivo pensado para publicarse como artefacto de claude.ai, donde guarda los datos en la base del artefacto; fuera de claude.ai usa `localStorage`.
- **Variante independiente:** `app/gastos-amigo.html`. Es un derivado de la v9 que solo guarda en el navegador y arranca con categorías básicas. No tiene la limpieza ni el rediseño de las versiones posteriores.
- **Historial:** cada cambio de versión es un commit; para comparar estilos, saca la versión anterior con `git show HEAD~1:app/gastos.html > /tmp/anterior.html`.

## Estructura de `gastos.html`

1. **`<style>`.** Va primero lo general (variables, cabecera, tarjetas, gráficos, hojas) y después cada pantalla. Cada selector se define una vez por contexto `@media`. Si hay que cambiar algo, se edita la regla que ya existe; no se añade una sobrescritura al final.
2. **HTML.** Es mínimo: cabecera, `#scroller > main#main`, barra inferior `#bnav` y botón `#fab`.
   - **Diseño «nativa de iPhone» (19-nov-2026):** tokens D (`--accent-fill`, `--spend` = color de los gastos en gráficos, `--bar`, `--sheet`, `--card-el`, `--tint-a`; `--exp` queda solo para avisos/errores); título grande `.ltitle` lo inserta `render()`; píldoras = `.chips > .chip` y `.subnav` (activa índigo); Resumen en columnas `.flow > .fl-a/.fl-b/.fl-c` con atajos `.qa`; la píldora `#periodBtn` abre `monthSheet()` en Resumen y `periodSheet()` en el resto.
3. **`<script>`.** Está dividido en secciones con cabeceras `/* ---------- nombre ---------- */`:
   - **Datos y cálculos:** utils, state, storage, periods, aggregations, previsión de fin de mes, ahorro del mes, fijos, ritmo por categoría, cambios de hábito e insights.
   - **Interfaz:** charts, vistas, render, toast, sheets, import/export y events.
   - **Movimiento:** animación de gráficos, transiciones, gestos del móvil y boot.

**Definiciones únicas.** Si una pantalla necesita una de estas cifras, debe llamar a la función correspondiente y no recalcularla:
- «Mes normal» es la media de los últimos 6 meses completos sin extraordinarios: `monthForecast().normal`, que usa `avgMonthly(6)`.
- La previsión de fin de mes sale de `forecastAt()`. El rango sale de `forecastRange()` y el ahorro del mes de `netForecastAt()`.
- Un gasto «puntual» es el que cumple `isLump()`: extraordinario, de 150 € o más, o de viaje.
- Los avisos salen de `allAlerts()` y solo se muestran en Resumen.

## Antes de publicar un cambio

```bash
git show HEAD:app/gastos.html > /tmp/anterior.html  # versión anterior
node tests/calc.test.js                   # 14 comprobaciones de los cálculos (todas deben pasar)
node tests/snap.js /tmp/anterior.html /tmp/antes    # estilo de cada pantalla, versión anterior
node tests/snap.js app/gastos.html /tmp/despues               # estilo de cada pantalla, versión nueva
node tests/snapdiff.js /tmp/antes /tmp/despues               # qué elementos cambian y en qué propiedad
```

- **`calc.test.js`** carga los 897 movimientos inventados de `datos-ejemplo/` con la fecha fija del 30-oct-2026. Comprueba la previsión (error medio del 16 %), la tasa de ahorro, el mes normal, los fijos, los avisos, la sugerencia de categoría y que exportar e importar un CSV no duplique nada.
- **`snap.js`** recorre todas las pestañas y subvistas, más la hoja de añadir. Lo hace en móvil, escritorio y móvil en horizontal, con tema claro y oscuro. Guarda el estilo calculado de cada elemento y una captura.
  - `snapdiff` solo debería mostrar las pantallas que querías cambiar.
  - Hay dos diferencias conocidas que aparecen aunque no cambies nada: el título de la cabecera en Movimientos (móvil) y un ±0,02 px en la cifra grande. Vienen de cuándo cargan las fuentes.
- **`tests/tools/cssmerge.py`** sirve para fusionar reglas CSS repetidas. Solo mueve una declaración si ninguna regla intermedia compite con ella. Después de usarlo hay que pasar `snap.js` y `snapdiff.js`.

Después, haz commit, regenera la demo con `python3 herramientas/construir-demo.py` y, si usas la app como artefacto de claude.ai, publícala desde `app/gastos.html` en el mismo artefacto para conservar el enlace.

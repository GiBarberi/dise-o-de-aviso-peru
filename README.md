# Diseñador de avisos Perú · versión para Render

Herramienta para vendedores de Perú: recomienda el formato más económico en La República, El Popular, Perú21 y La Razón (tarifas 2026) y descarga el aviso en PDF a medida. La IA (Gemini, cuota gratuita) ordena el texto en título, cuerpo y firma.

## Probar en tu computadora

1. Necesitás Node.js 20 o más nuevo.
2. Sacá una clave gratis en Google AI Studio (aistudio.google.com → Get API key).
3. En esta carpeta: `GEMINI_API_KEY=tu_clave npm start` (en Windows PowerShell: `$env:GEMINI_API_KEY="tu_clave"; npm start`).
4. Abrí http://localhost:3000

## Publicarlo gratis en Render

1. Subí esta carpeta a un repositorio de GitHub.
2. En Render → New → Blueprint, elegí el repositorio: Render lee `render.yaml` y crea el servicio en el plan gratis.
3. Cuando te pida `GEMINI_API_KEY`, pegá tu clave. Queda guardada en Render, no en el código.
4. Al terminar, Render te da una dirección tipo `https://avisos-la-republica.onrender.com`.

Plan gratis: el servicio se duerme tras 15 minutos sin uso y la primera visita después tarda alrededor de un minuto en despertar.

## Archivos

- `public/index.html`: la herramienta (tarifas y medidas en la constante `FORMATS`).
- `server.js`: sirve la página y la ruta `/api/ordenar`, que llama a Gemini con la clave del servidor.
- `render.yaml`: configuración del servicio para Render.

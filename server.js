// Servidor mínimo para Render: sirve public/index.html y POST /api/ordenar (Gemini).
// Sin dependencias: Node 20+ (fetch incluido). Variable de entorno: GEMINI_API_KEY.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODELS = (process.env.GEMINI_MODELS || "gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);

const PROMPT = (texto) => `Sos asistente de un vendedor de avisos legales en Perú. Separá el texto de abajo en título, cuerpo y firma para un aviso en el diario La República.
Reglas: no cambies, resumas ni agregues contenido legal; solo corregí espacios dobles y saltos de línea rotos. El título es corto (por ejemplo EDICTO, AVISO, CONVOCATORIA, REMATE). El cuerpo es una lista de párrafos. La firma son las líneas finales con nombre y cargo, si existen. En "faltantes" listá datos que suelen ser obligatorios y no aparecen (número de expediente, juzgado, fecha, nombre de quien firma); lista vacía si no falta nada.
Respondé solo con JSON: {"titulo":"","cuerpo":[""],"firma":[""],"faltantes":[""]}

TEXTO:
${texto}`;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) { data += chunk; if (data.length > 20000) break; }
  return data;
}

async function ordenar(req, res) {
  if (!process.env.GEMINI_API_KEY) return send(res, 500, { error: "Falta GEMINI_API_KEY" });
  let texto = "";
  try { texto = String(JSON.parse(await readBody(req)).texto || "").slice(0, 8000).trim(); }
  catch { return send(res, 400, { error: "JSON inválido" }); }
  if (!texto) return send(res, 400, { error: "Texto vacío" });

  // Si un modelo está saturado (429/500/503), prueba el siguiente.
  let data = null, lastStatus = 0;
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT(texto) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
    if (r.ok) { data = await r.json(); break; }
    lastStatus = r.status;
    if (![429, 500, 503].includes(r.status)) break;
  }
  if (!data) return send(res, 502, { error: "Error de Gemini " + lastStatus });
  let out = {};
  try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}"); }
  catch { return send(res, 502, { error: "Respuesta no válida de la IA" }); }
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  send(res, 200, { titulo: String(out.titulo || ""), cuerpo: arr(out.cuerpo), firma: arr(out.firma), faltantes: arr(out.faltantes) });
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/ordenar") return await ordenar(req, res);
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      return send(res, 200, await readFile(path.join(__dirname, "public", "index.html"), "utf8"), "text/html; charset=utf-8");
    }
    send(res, 404, { error: "No encontrado" });
  } catch (e) {
    send(res, 500, { error: "Error interno" });
  }
}).listen(PORT, () => console.log("Avisos La República en http://localhost:" + PORT));

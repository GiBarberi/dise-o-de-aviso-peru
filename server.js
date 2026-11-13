// Servidor mínimo para Render: sirve public/index.html y POST /api/ordenar (Gemini).
// Sin dependencias: Node 20+ (fetch incluido). Variable de entorno: GEMINI_API_KEY.
// /api/ordenar recibe {tipo, diario, texto} o {tipo, diario, archivos:[{mime, data(base64)}]} (PDF o fotos).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODELS = (process.env.GEMINI_MODELS || "gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);
const MAX_BODY = 9 * 1024 * 1024;
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const TIPOS = {
  edicto: ["edicto judicial o notarial (sucesión, rectificación, notificación, etc.)",
    "número de expediente, juzgado o notaría, fecha, nombre y cargo de quien firma"],
  petitorio: ["petitorio de concesión minera: membrete de la entidad en el encabezado; título PETITORIO DE CONCESIÓN MINERA; párrafo legal de consulta previa; la sección DATOS Y UBICACIÓN DEL PETITORIO con ## y sus datos como filas de dos columnas (\"Nombre: | valor\"), dejando un renglón vacío entre grupos; el subtítulo de coordenadas con # y la tabla con encabezado (\"|| VÉRTICE | NORTE | ESTE\")",
    "nombre del petitorio, código, titular, hectáreas, ubicación, coordenadas, fecha, firmante"],
  junta: ["convocatoria a junta general de accionistas o asociados: título, párrafo con empresa, fecha, hora y lugar; \"**Orden del día:**\" y cada punto como renglón numerado (\"1. ...\")",
    "razón social, fecha y hora, lugar, orden del día, quién convoca"],
  remate: ["convocatoria de remate judicial: en el encabezado los datos del martillero (nombre, profesión, contactos); título; párrafo del expediente; ## para la descripción del bien; cada característica como viñeta \"• **Etiqueta:** valor\"; valores, gravámenes, día, hora y lugar como \"**Etiqueta:** valor\"; requisitos de los postores numerados; la fecha va en el campo fecha y la firma del especialista en firmas",
    "expediente, juzgado, valor de tasación, base del remate, día y hora, lugar del remate"],
  comunicado: ["comunicado al público: título; párrafo introductorio; los datos tabulares como tabla con fila de encabezado (\"|| COL1 | COL2 | ...\") y una fila por renglón (\"dato | dato | ...\"); párrafo de cierre; fecha y área o entidad que firma",
    "entidad, fecha, área que firma"],
};

const PROMPT = (tipo, diario, texto) => {
  const [que, falt] = TIPOS[tipo] || TIPOS.edicto;
  return `Sos asistente de un vendedor de avisos legales en Perú. Vas a preparar un ${que} para publicar en el diario ${diario}.
${texto ? "Usá el texto de abajo." : "Transcribí el texto completo del archivo adjunto (PDF o foto) con sus acentos; si una parte no se lee, poné [ilegible]."}
Reglas: no cambies, resumas ni agregues contenido legal; solo corregí espacios dobles, guiones de corte de palabra y saltos de línea rotos.
Separá en:
- "encabezado": renglones del membrete que va arriba del título (entidad, martillero, contactos); lista vacía si no hay.
- "titulo": el título principal.
- "cuerpo": lista de renglones con este formato: un renglón por párrafo; "## TEXTO" para subtítulos de sección; "# TEXTO" para subtítulos centrados; "• texto" para viñetas; "1. texto" para puntos numerados; "**texto**" solo donde el original está en negrita; tablas con celdas separadas por " | ", una fila por renglón y la fila de encabezados empezando con "|| "; "" para dejar un espacio entre bloques. Las tablas van completas, con todas sus filas y columnas; si una celda tiene varios renglones (dos nombres, dos coordenadas) separalos con <br>; si la tabla tiene encabezados agrupados, aplaná todo en una sola fila de encabezados y poné el título del grupo como subtítulo "# " antes de la tabla.
- "fecha": el renglón de lugar y fecha que va antes de las firmas ("" si no hay).
- "firmas": lista de firmas; cada firma es una lista de renglones (nombre, cargo, entidad). Si firman 2 o 3 personas o áreas, separalas.
- "faltantes": datos que suelen ser obligatorios en este tipo de aviso y no aparecen (${falt}); lista vacía si no falta nada.
Respondé solo con JSON: {"encabezado":[""],"titulo":"","cuerpo":[""],"fecha":"","firmas":[[""]],"faltantes":[""]}
${texto ? "\nTEXTO:\n" + texto : ""}`;
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) { data += chunk; if (data.length > MAX_BODY) return null; }
  return data;
}

const arr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String(x ?? ""))) : []);
function firmas(v) {
  if (!Array.isArray(v)) return [];
  if (v.every((x) => typeof x === "string")) return v.length ? [v] : [];
  return v.map((f) => (Array.isArray(f) ? arr(f) : [String(f)])).filter((f) => f.join("").trim());
}

async function ordenar(req, res) {
  if (!process.env.GEMINI_API_KEY) return send(res, 500, { error: "Falta GEMINI_API_KEY" });
  const raw = await readBody(req);
  if (raw === null) return send(res, 413, { error: "El archivo es demasiado grande" });
  let texto = "", diario = "La República", tipo = "edicto", archivos = [];
  try {
    const j = JSON.parse(raw);
    texto = String(j.texto || "").slice(0, 20000).trim();
    diario = String(j.diario || diario).slice(0, 40);
    tipo = TIPOS[j.tipo] ? j.tipo : "edicto";
    archivos = (Array.isArray(j.archivos) ? j.archivos : []).slice(0, 3)
      .filter((a) => a && MIMES.includes(a.mime) && typeof a.data === "string" && /^[A-Za-z0-9+/=]+$/.test(a.data));
  } catch { return send(res, 400, { error: "JSON inválido" }); }
  if (!texto && !archivos.length) return send(res, 400, { error: "No llegó texto ni archivo" });

  const parts = [{ text: PROMPT(tipo, diario, texto) }];
  if (!texto) archivos.forEach((a) => parts.push({ inline_data: { mime_type: a.mime, data: a.data } }));

  // Si un modelo está saturado, no existe o tarda demasiado, prueba el siguiente.
  let data = null, lastStatus = 0;
  for (const model of MODELS) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(70000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      });
    } catch { lastStatus = 504; continue; } // demoró demasiado: prueba el siguiente modelo
    if (r.ok) { data = await r.json(); break; }
    lastStatus = r.status;
    if ([400, 401, 403].includes(r.status)) break; // clave o pedido inválido: no tiene sentido reintentar
  }
  if (!data) return send(res, 502, { error: "Error de Gemini " + lastStatus });
  let out = {};
  try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}"); }
  catch { return send(res, 502, { error: "Respuesta no válida de la IA" }); }
  send(res, 200, {
    encabezado: arr(out.encabezado), titulo: String(out.titulo || ""), cuerpo: arr(out.cuerpo),
    fecha: String(out.fecha || ""), firmas: firmas(out.firmas ?? out.firma), faltantes: arr(out.faltantes),
  });
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
}).listen(PORT, () => console.log("Diseño de avisos Perú en http://localhost:" + PORT));

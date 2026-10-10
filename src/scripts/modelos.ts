// Lista los modelos de Gemini que puede usar tu clave y, si le pasas uno, lo prueba
// con una herramienta (que es lo que hará el agente).
//
//   bun run modelos                    -> lista los modelos disponibles
//   bun run modelos gemini-xxxx        -> prueba ese modelo 3 veces: velocidad y llamada a herramienta
import { z } from "zod"

const BASE = "https://generativelanguage.googleapis.com/v1beta"

const claveEntorno = process.env.GEMINI_API_KEY
if (!claveEntorno) {
  console.log("Falta GEMINI_API_KEY. Pégala en el archivo .env, guarda con Ctrl+S y vuelve a ejecutar.")
  process.exit(1)
}
const clave: string = claveEntorno

// Una llamada HTTP a la API. La clave va en un encabezado (no en la URL) para que
// nunca aparezca en un mensaje de error. Si algo falla, devuelve el motivo en texto.
async function llamar(ruta: string, cuerpo?: unknown): Promise<{ estado: number; json: unknown; ms: number }> {
  const inicio = performance.now()
  try {
    const respuesta = await fetch(`${BASE}${ruta}`, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: { "x-goog-api-key": clave, "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000), // si Google no responde en 30 s, se corta
    })
    const json: unknown = await respuesta.json().catch(() => null)
    return { estado: respuesta.status, json, ms: Math.round(performance.now() - inicio) }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    return { estado: 0, json: { error: { message: `No se pudo conectar: ${motivo}` } }, ms: Math.round(performance.now() - inicio) }
  }
}

// Saca el mensaje de error de la respuesta de Google (si lo hay).
function mensajeDeError(json: unknown): string {
  const parseo = z.object({ error: z.object({ message: z.string() }) }).safeParse(json)
  return parseo.success ? parseo.data.error.message : "respuesta sin detalle"
}

// ---------- Modo 1: listar modelos ----------

const EsquemaListado = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      displayName: z.string().optional(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
  nextPageToken: z.string().optional(),
})

async function listarModelos(): Promise<void> {
  const encontrados: string[] = []
  let pagina: string | undefined

  for (let i = 0; i < 10; i++) {
    const { estado, json } = await llamar(`/models?pageSize=100${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`)
    if (estado !== 200) {
      console.log(`Error ${estado} al listar modelos: ${mensajeDeError(json)}`)
      process.exit(1)
    }
    const datos = EsquemaListado.parse(json)
    for (const m of datos.models) {
      // Solo modelos Gemini que sirven para conversar (generateContent).
      if (m.name.includes("gemini") && m.supportedGenerationMethods?.includes("generateContent")) {
        encontrados.push(`${m.name.replace("models/", "")}  (${m.displayName ?? "sin nombre"})`)
      }
    }
    pagina = datos.nextPageToken
    if (!pagina) break
  }

  console.log(`Modelos Gemini disponibles para tu clave (${encontrados.length}):\n`)
  for (const linea of encontrados.sort()) console.log(`  ${linea}`)
  console.log("\nPrueba uno con:  bun run modelos <nombre-del-modelo>")
}

// ---------- Modo 2: probar un modelo con una herramienta ----------

const EsquemaRespuesta = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                functionCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() }).optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .optional(),
})

async function probarModelo(nombre: string): Promise<void> {
  const modelo = nombre.replace(/^models\//, "")
  const cuerpo = {
    contents: [{ role: "user", parts: [{ text: "Usa la herramienta sumar para calcular 2 + 3." }] }],
    tools: [
      {
        functionDeclarations: [
          {
            name: "sumar",
            description: "Suma dos números",
            parameters: {
              type: "OBJECT",
              properties: { a: { type: "NUMBER" }, b: { type: "NUMBER" } },
              required: ["a", "b"],
            },
          },
        ],
      },
    ],
  }

  console.log(`Probando ${modelo} (3 llamadas seguidas)...\n`)
  for (let i = 1; i <= 3; i++) {
    const { estado, json, ms } = await llamar(`/models/${modelo}:generateContent`, cuerpo)
    if (estado !== 200) {
      console.log(`  #${i}: error ${estado} en ${ms} ms -> ${mensajeDeError(json)}`)
      if (estado === 404) console.log("       Ese modelo no existe para tu clave. Ejecuta sin argumento para ver la lista.")
      if (estado === 429) console.log("       Límite de uso alcanzado (cuota o peticiones por minuto del nivel gratuito).")
      continue
    }
    const partes = EsquemaRespuesta.parse(json).candidates?.[0]?.content?.parts ?? []
    const llamada = partes.find((p) => p.functionCall)?.functionCall
    const resultado = llamada
      ? `llamó a la herramienta ${llamada.name}(${JSON.stringify(llamada.args ?? {})})`
      : `NO llamó a la herramienta; respondió texto: ${partes.map((p) => p.text ?? "").join("").slice(0, 80)}`
    console.log(`  #${i}: OK en ${ms} ms -> ${resultado}`)
  }
}

// ---------- Programa principal ----------

const modeloPedido = process.argv[2]
if (modeloPedido) await probarModelo(modeloPedido)
else await listarModelos()

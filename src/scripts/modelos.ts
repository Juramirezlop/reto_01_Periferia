// Lista los modelos de Gemini disponibles para tu clave y prueba los que le indiques.

import { z } from "zod"

const BASE = "https://generativelanguage.googleapis.com/v1beta"

const claveEntorno = process.env.GEMINI_API_KEY
if (!claveEntorno) {
  console.log("Falta GEMINI_API_KEY. Pégala en el archivo .env, guarda con Ctrl+S y vuelve a ejecutar.")
  process.exit(1)
}
const clave: string = claveEntorno

// Llamada HTTP a la API
async function llamar(ruta: string, cuerpo?: unknown): Promise<{ estado: number; json: unknown; ms: number }> {
  const inicio = performance.now()
  try {
    const respuesta = await fetch(`${BASE}${ruta}`, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: { "x-goog-api-key": clave, "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000), // corta a los 30 s
    })
    const json: unknown = await respuesta.json().catch(() => null)
    return { estado: respuesta.status, json, ms: Math.round(performance.now() - inicio) }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    return { estado: 0, json: { error: { message: `No se pudo conectar: ${motivo}` } }, ms: Math.round(performance.now() - inicio) }
  }
}

// Extrae el mensaje de error de la respuesta de Google.
function mensajeDeError(json: unknown): string {
  const parseo = z.object({ error: z.object({ message: z.string() }) }).safeParse(json)
  return parseo.success ? parseo.data.error.message : "respuesta sin detalle"
}

// ---------- listar modelos ----------

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
      // Solo modelos Gemini que sirven para conversar
      if (m.name.includes("gemini") && m.supportedGenerationMethods?.includes("generateContent")) {
        encontrados.push(`${m.name.replace("models/", "")}  (${m.displayName ?? "sin nombre"})`)
      }
    }
    pagina = datos.nextPageToken
    if (!pagina) break
  }

  console.log(`Modelos Gemini disponibles para tu clave (${encontrados.length}):\n`)
  for (const linea of encontrados.sort()) console.log(`  ${linea}`)
  console.log("\nPrueba varios con:  bun run modelos <modelo-1> <modelo-2> ...")
}

// ---------- probar modelos con una herramienta ----------

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

  console.log(`\n${modelo}`)
  const tiempos: number[] = []
  let conHerramienta = 0

  for (let i = 1; i <= 3; i++) {
    const { estado, json, ms } = await llamar(`/models/${modelo}:generateContent`, cuerpo)
    if (estado !== 200) {
      console.log(`  #${i}: error ${estado} en ${ms} ms -> ${mensajeDeError(json).slice(0, 160)}`)
      if (estado === 404) console.log("       No disponible para tu clave (puede estar retirado para cuentas nuevas). Elige otro de la lista.")
      if (estado === 429) console.log("       Límite de uso alcanzado (cuota o peticiones por minuto del nivel gratuito).")
      continue
    }
    const partes = EsquemaRespuesta.parse(json).candidates?.[0]?.content?.parts ?? []
    const llamada = partes.find((p) => p.functionCall)?.functionCall
    const resultado = llamada
      ? `llamó a la herramienta ${llamada.name}(${JSON.stringify(llamada.args ?? {})})`
      : `NO llamó a la herramienta; respondió texto: ${partes.map((p) => p.text ?? "").join("").slice(0, 80)}`
    console.log(`  #${i}: OK en ${ms} ms -> ${resultado}`)
    tiempos.push(ms)
    if (llamada) conHerramienta++
  }

  // Mediana de las respuestas que llegaron
  const ordenados = [...tiempos].sort((a, b) => a - b)
  const tipico = ordenados.length > 0 ? `${ordenados[Math.floor(ordenados.length / 2)]} ms` : "sin datos"
  console.log(`  Resumen: ${tiempos.length}/3 respuestas, ${conHerramienta}/3 con herramienta, tiempo típico ${tipico}`)
}

// ---------- Programa principal ----------

const modelosPedidos = process.argv.slice(2)
if (modelosPedidos.length > 0) {
  for (const modelo of modelosPedidos) await probarModelo(modelo)
} else {
  await listarModelos()
}
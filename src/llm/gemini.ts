import { ErrorModelo, type Adaptador, type DeclaracionHerramienta, type Entrada } from "./adapter"

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

type Parte = Record<string, unknown>
type Contenido = { role: "user" | "model"; parts: Parte[] }

// Gemini pide los tipos en MAYÚSCULAS (STRING, OBJECT...). Convierte el esquema JSON de zod.
function aEsquemaGemini(esquema: unknown): unknown {
  if (Array.isArray(esquema)) return esquema.map(aEsquemaGemini)
  if (typeof esquema !== "object" || esquema === null) return esquema
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(esquema)) {
    if (clave === "$schema" || clave === "additionalProperties") continue // Gemini no los acepta
    salida[clave] = clave === "type" && typeof valor === "string" ? valor.toUpperCase() : aEsquemaGemini(valor)
  }
  return salida
}

// Traduce nuestro historial neutral al formato de Gemini.
function aContenidos(historial: Entrada[]): Contenido[] {
  const contenidos: Contenido[] = []
  for (const e of historial) {
    if (e.tipo === "usuario") {
      contenidos.push({ role: "user", parts: [{ text: e.texto }] })
    } else if (e.tipo === "modelo") {
      // Si hay mensaje crudo se reenvía tal cual; si no, se reconstruye.
      const crudo = e.crudo as Contenido | undefined
      contenidos.push(
        crudo ?? {
          role: "model",
          parts: [...(e.texto ? [{ text: e.texto }] : []), ...e.llamadas.map((l) => ({ functionCall: { name: l.nombre, args: l.args } }))],
        },
      )
    } else {
      // Todos los resultados seguidos van en UN solo mensaje de usuario.
      const parte = { functionResponse: { name: e.nombre, response: { resultado: e.contenido } } }
      const ultimo = contenidos[contenidos.length - 1]
      if (ultimo && ultimo.role === "user" && ultimo.parts.every((p) => "functionResponse" in p)) ultimo.parts.push(parte)
      else contenidos.push({ role: "user", parts: [parte] })
    }
  }
  return contenidos
}

export function crearGemini(opciones: { apiKey: string; modelo: string; timeoutMs?: number }): Adaptador {
  return {
    async generar({ sistema, historial, herramientas }) {
      const declaraciones = herramientas.map((h: DeclaracionHerramienta) => ({
        name: h.nombre,
        description: h.descripcion,
        parameters: aEsquemaGemini(h.parametros),
      }))

      let respuesta: Response
      try {
        respuesta = await fetch(`${URL_BASE}/${opciones.modelo}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opciones.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sistema }] },
            contents: aContenidos(historial),
            tools: [{ functionDeclarations: declaraciones }],
          }),
          signal: AbortSignal.timeout(opciones.timeoutMs ?? 20_000), // PRD: sin colgarse si el modelo tarda
        })
      } catch (e) {
        const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        throw new ErrorModelo(tiempo ? `${opciones.modelo}: tiempo agotado` : `${opciones.modelo}: sin conexión`, true)
      }

      if (!respuesta.ok) {
        const detalle = (await respuesta.text()).slice(0, 200)
        // 429 (límite) y 5xx (caída) merecen probar el respaldo; 400/403/404 no.
        throw new ErrorModelo(`${opciones.modelo}: HTTP ${respuesta.status} ${detalle}`, respuesta.status === 429 || respuesta.status >= 500)
      }

      const json = (await respuesta.json()) as { candidates?: { content?: Contenido }[]; usageMetadata?: { totalTokenCount?: number } }
      const contenido = json.candidates?.[0]?.content
      if (!contenido?.parts) throw new ErrorModelo(`${opciones.modelo}: respuesta vacía`, true)

      const texto = contenido.parts.map((p) => (typeof p.text === "string" && !p.thought ? p.text : "")).join("")
      const llamadas = contenido.parts.flatMap((p) => {
        const f = p.functionCall as { name: string; args?: unknown } | undefined
        return f ? [{ nombre: f.name, args: f.args ?? {} }] : []
      })
      return { texto, llamadas, crudo: { role: "model", parts: contenido.parts }, tokens: json.usageMetadata?.totalTokenCount }
    },
  }
}

import { responder, type Resultado } from "./agent/loop"
import { construirSistema } from "./agent/sistema"
import { config } from "./config"
import type { Adaptador, Entrada } from "./llm/adapter"
import { crearGemini } from "./llm/gemini"
import type { Ctx } from "./tools/util"

// Una conversación por sessionId, en memoria (el PRD no pide base de datos).
const sesiones = new Map<string, Entrada[]>()

function adaptadoresPorDefecto(): Adaptador[] {
  return [config.modelo, config.modeloRespaldo]
    .filter((m, i, todos) => m && todos.indexOf(m) === i)
    .map((modelo) => crearGemini({ apiKey: config.apiKey, modelo }))
}

export async function manejarMensaje(
  sessionId: string,
  mensaje: string,
  directory = process.cwd(),
  adaptadoresPrueba?: Adaptador[], // las pruebas inyectan un modelo simulado
): Promise<Resultado> {
  if (!adaptadoresPrueba && !config.apiKey) {
    return { respuesta: "Falta GEMINI_API_KEY en el archivo .env.", herramientas: [] }
  }
  const adaptadores = adaptadoresPrueba ?? adaptadoresPorDefecto()
  const ctx: Ctx = { directory, sessionId }
  const historial = sesiones.get(sessionId) ?? []
  sesiones.set(sessionId, historial)
  return responder({ adaptadores, sistema: await construirSistema(ctx), historial, mensaje, ctx })
}

export const reiniciarSesion = (sessionId: string) => sesiones.delete(sessionId)

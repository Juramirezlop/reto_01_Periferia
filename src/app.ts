import { responder, resumir, type Resultado, type Sesion } from "./agent/loop"
import { construirSistema } from "./agent/sistema"
import { config } from "./config"
import type { Adaptador } from "./llm/adapter"
import { crearGemini } from "./llm/gemini"
import type { Ctx } from "../modulo/tools/util"

// Una conversación por sessionId
const sesiones = new Map<string, Sesion>()

function adaptadoresPorDefecto(): Adaptador[] {
  return [config.modelo, config.modeloRespaldo]
    .filter((m, i, todos) => m && todos.indexOf(m) === i)
    .map((modelo) => crearGemini({ apiKey: config.apiKey, modelo }))
}

export async function manejarMensaje(
  sessionId: string,
  mensaje: string,
  directory = process.cwd(),
  adaptadoresPrueba?: Adaptador[], // permite inyectar un modelo simulado en las pruebas
): Promise<Resultado> {
  if (!adaptadoresPrueba && !config.apiKey) {
    return { respuesta: "Falta GEMINI_API_KEY en el archivo .env.", herramientas: [], pideConfirmacion: false }
  }
  const adaptadores = adaptadoresPrueba ?? adaptadoresPorDefecto()
  const ctx: Ctx = { directory, sessionId }
  const sesion = sesiones.get(sessionId) ?? { historial: [], tokens: 0 }
  sesiones.set(sessionId, sesion)
  const limites = { maxPasos: config.maxPasos, maxTokens: config.maxTokensSesion }
  return responder({ adaptadores, sistema: await construirSistema(ctx), sesion, limites, mensaje, ctx })
}

export const reiniciarSesion = (sessionId: string) => sesiones.delete(sessionId)

// Historial de una sesión sin datos internos del proveedor
export function historialSesion(sessionId: string) {
  const sesion = sesiones.get(sessionId)
  if (!sesion) return null
  const mensajes = sesion.historial.map((e) =>
    e.tipo === "usuario"
      ? { rol: "usuario", texto: e.texto }
      : e.tipo === "modelo"
        ? { rol: "agente", texto: e.texto, herramientas: e.llamadas.map((l) => l.nombre) }
        : { rol: "herramienta", nombre: e.nombre, resumen: resumir(e.contenido) },
  )
  return { sessionId, tokens: sesion.tokens, mensajes }
}

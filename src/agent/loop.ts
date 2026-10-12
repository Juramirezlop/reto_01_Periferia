import { ErrorModelo, type Adaptador, type Entrada } from "../llm/adapter"
import type { Ctx } from "../../modulo/tools/util"
import { declaraciones, ejecutar } from "./herramientas"
import { confirmaEnvio } from "./sistema"

// Entendimiento de analista y confirmación
const ultimoTextoDelAgente = (historial: Entrada[]) =>
  [...historial].reverse().find((e): e is Extract<Entrada, { tipo: "modelo" }> => e.tipo === "modelo" && e.texto !== "")?.texto ?? ""

export type Resultado = { respuesta: string; herramientas: { nombre: string; ok: boolean }[]; tokens?: number }

// Estado de una conversación
export type Sesion = { historial: Entrada[]; tokens: number }
export type Limites = { maxPasos: number; maxTokens: number }

// Funcionalidad de chat por turnos
export async function responder(opciones: {
  adaptadores: Adaptador[]
  sistema: string
  sesion: Sesion // se actualiza en cada turno
  limites: Limites
  mensaje: string
  ctx: Ctx
}): Promise<Resultado> {
  const { adaptadores, sistema, sesion, limites, mensaje, ctx } = opciones
  const { historial } = sesion
  const usadas: Resultado["herramientas"] = []
  const yaEjecutadas = new Map<string, string>() // llamada -> resultado, para no repetirla en el mismo mensaje
  const confirmo = confirmaEnvio(mensaje, ultimoTextoDelAgente(historial))
  historial.push({ tipo: "usuario", texto: mensaje })

  for (let paso = 0; paso < limites.maxPasos; paso++) {
    if (sesion.tokens >= limites.maxTokens) {
      return { respuesta: "Esta conversación alcanzó su límite de uso. Pulsa ↺ para empezar una nueva.", herramientas: usadas, tokens: sesion.tokens }
    }
    // Prueba cada modelo hasta que uno responda
    let respuesta
    let ultimoError = "sin modelos configurados"
    for (const adaptador of adaptadores) {
      try {
        respuesta = await adaptador.generar({ sistema, historial, herramientas: declaraciones() })
        break
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e)
        if (!(e instanceof ErrorModelo && e.reintentable)) break // con un error como clave inválida el respaldo no ayuda
      }
    }
    if (!respuesta) {
      return { respuesta: `No pude consultar el modelo (${ultimoError}). Intenta de nuevo en un momento.`, herramientas: usadas, tokens: sesion.tokens }
    }

    sesion.tokens += respuesta.tokens ?? 0
    historial.push({ tipo: "modelo", texto: respuesta.texto, llamadas: respuesta.llamadas, crudo: respuesta.crudo })
    if (respuesta.llamadas.length === 0) return { respuesta: respuesta.texto, herramientas: usadas, tokens: sesion.tokens }

    for (const llamada of respuesta.llamadas) {
      // Si el modelo repite la misma llamada, se reutiliza el resultado
      const clave = `${llamada.nombre}:${JSON.stringify(llamada.args)}`
      const contenido = yaEjecutadas.get(clave) ?? (await ejecutar(llamada.nombre, llamada.args, ctx, confirmo))
      yaEjecutadas.set(clave, contenido)
      usadas.push({ nombre: llamada.nombre, ok: (JSON.parse(contenido) as { ok: boolean }).ok })
      historial.push({ tipo: "resultado", nombre: llamada.nombre, contenido })
    }
  }
  return { respuesta: "Llegué al límite de pasos sin terminar. Pídeme algo más acotado.", herramientas: usadas, tokens: sesion.tokens }
}

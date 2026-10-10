import { ErrorModelo, type Adaptador, type Entrada } from "../llm/adapter"
import type { Ctx } from "../tools/util"
import { declaraciones, ejecutar } from "./herramientas"
import { confirmaEnvio } from "./sistema"

export type Resultado = { respuesta: string; herramientas: { nombre: string; ok: boolean }[] }

const MAX_PASOS = 8 // tope de idas y vueltas con el modelo por mensaje (control de costo)

// Un turno del agente: el usuario escribe -> el modelo pide herramientas -> se ejecutan -> repite -> respuesta.
// `adaptadores` va en orden de preferencia: el primero es el principal, el resto son respaldo.
export async function responder(opciones: {
  adaptadores: Adaptador[]
  sistema: string
  historial: Entrada[] // se modifica: así la conversación recuerda lo anterior
  mensaje: string
  ctx: Ctx
}): Promise<Resultado> {
  const { adaptadores, sistema, historial, mensaje, ctx } = opciones
  const usadas: Resultado["herramientas"] = []
  const confirmo = confirmaEnvio(mensaje)
  historial.push({ tipo: "usuario", texto: mensaje })

  for (let paso = 0; paso < MAX_PASOS; paso++) {
    // Probamos cada modelo hasta que uno responda.
    let respuesta
    let ultimoError = "sin modelos configurados"
    for (const adaptador of adaptadores) {
      try {
        respuesta = await adaptador.generar({ sistema, historial, herramientas: declaraciones() })
        break
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e)
        if (!(e instanceof ErrorModelo && e.reintentable)) break // errores como clave inválida no se arreglan con el respaldo
      }
    }
    if (!respuesta) {
      return { respuesta: `No pude consultar el modelo (${ultimoError}). Intenta de nuevo en un momento.`, herramientas: usadas }
    }

    historial.push({ tipo: "modelo", texto: respuesta.texto, llamadas: respuesta.llamadas, crudo: respuesta.crudo })
    if (respuesta.llamadas.length === 0) return { respuesta: respuesta.texto, herramientas: usadas }

    for (const llamada of respuesta.llamadas) {
      const contenido = await ejecutar(llamada.nombre, llamada.args, ctx, confirmo)
      usadas.push({ nombre: llamada.nombre, ok: (JSON.parse(contenido) as { ok: boolean }).ok })
      historial.push({ tipo: "resultado", nombre: llamada.nombre, contenido })
    }
  }
  return { respuesta: "Llegué al límite de pasos sin terminar. Pídeme algo más acotado.", herramientas: usadas }
}

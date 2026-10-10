import type { Glosario, Maestro } from "./datos"
import { normalizar, obtenerPorRuta } from "./util"

// RN1: cómo se llama el identificador tributario en cada país.
export const ID_TRIBUTARIO: Record<string, string> = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" }

// HU-1: etiquetas que no dicen qué documento piden (ya normalizadas: sin tildes ni mayúsculas).
const ETIQUETAS_AMBIGUAS = ["identificacion tributaria", "numero de identificacion fiscal"]

export const esAmbigua = (etiqueta: string) => ETIQUETAS_AMBIGUAS.includes(normalizar(etiqueta))

// Cada campo pedido termina en EXACTAMENTE uno de estos tres estados.
export type Lleno = { etiqueta: string; ruta: string; valor: unknown }
export type PorConfirmar = { etiqueta: string; ruta: string; valor: unknown; confianza: number; nota: string }
export type Faltante = { etiqueta: string; motivo: string }
export type Mapeo = { llenos: Lleno[]; faltantes: Faltante[]; requiere_confirmacion: PorConfirmar[] }

type Coincidencia = { ruta: string; confianza: number; clave: string }

// Busca la ruta del maestro para una etiqueta usando el glosario.
//  - Igual (sin tildes ni mayúsculas)      -> confianza 1.0
//  - Una contiene a la otra (ej. "Dirección de entrega" contiene "Dirección") -> 0.7
function buscarEnGlosario(etiqueta: string, glosario: Glosario): Coincidencia | undefined {
  const buscada = normalizar(etiqueta)
  let mejorParcial: Coincidencia | undefined

  for (const [clave, ruta] of Object.entries(glosario)) {
    const claveNormal = normalizar(clave)
    if (claveNormal === buscada) return { ruta, confianza: 1, clave }
    const parcial = claveNormal.length >= 5 && (buscada.includes(claveNormal) || claveNormal.includes(buscada))
    // Si hay varias parciales gana la más larga (la más específica).
    if (parcial && (!mejorParcial || clave.length > mejorParcial.clave.length)) {
      mejorParcial = { ruta, confianza: 0.7, clave }
    }
  }
  return mejorParcial
}

// El corazón de HU-2. Es código determinista: el modelo NO decide ningún valor.
export function mapearCampos(etiquetas: string[], pais: string, glosario: Glosario, maestro: Maestro): Mapeo {
  const mapeo: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] }

  for (const etiqueta of etiquetas) {
    const coincidencia = buscarEnGlosario(etiqueta, glosario)
    if (!coincidencia) {
      mapeo.faltantes.push({ etiqueta, motivo: "No hay un campo equivalente en el repositorio maestro." })
      continue
    }

    const { ruta, confianza, clave } = coincidencia
    const valor = obtenerPorRuta(maestro, ruta)
    if (valor === undefined || valor === null || valor === "") {
      mapeo.faltantes.push({ etiqueta, motivo: `El dato "${ruta}" no existe o está vacío en el maestro.` })
      continue
    }

    // Reunimos los motivos por los que un humano debería confirmar.
    const notas: string[] = []
    if (confianza < 0.8) notas.push(`Coincidencia parcial con "${clave}" (confianza ${confianza}).`)
    if (esAmbigua(etiqueta)) {
      notas.push(`Etiqueta ambigua; propuesta: ${ID_TRIBUTARIO[pais] ?? "identificador tributario del país"}.`)
    }
    if (ruta === "nit" && pais !== "CO") {
      notas.push(`Identificador extranjero: Periferia solo tiene NIT colombiano; el cliente pide ${ID_TRIBUTARIO[pais] ?? "otro identificador"}.`)
    }

    if (notas.length > 0) {
      mapeo.requiere_confirmacion.push({ etiqueta, ruta, valor, confianza, nota: notas.join(" ") })
    } else {
      mapeo.llenos.push({ etiqueta, ruta, valor })
    }
  }
  return mapeo
}

// Para escribir el formulario: etiqueta -> valor (solo lo que salió del maestro).
export function valoresPorEtiqueta(mapeo: Mapeo): Map<string, unknown> {
  const valores = new Map<string, unknown>()
  for (const l of mapeo.llenos) valores.set(l.etiqueta, l.valor)
  for (const c of mapeo.requiere_confirmacion) valores.set(c.etiqueta, c.valor)
  return valores
}

import type { Glosario, Maestro } from "./datos"
import { normalizar, obtenerPorRuta } from "./util"

// RN1: cómo se llama el identificador tributario en cada país
export const ID_TRIBUTARIO: Record<string, string> = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" }

// Etiquetas que no dicen qué documento piden
const ETIQUETAS_AMBIGUAS = ["identificacion tributaria", "numero de identificacion fiscal"]

export const esAmbigua = (etiqueta: string) => ETIQUETAS_AMBIGUAS.includes(normalizar(etiqueta))

// Estados posibles
export type Lleno = { etiqueta: string; ruta: string; valor: unknown }
export type PorConfirmar = { etiqueta: string; ruta: string; valor: unknown; confianza: number; nota: string }
export type Faltante = { etiqueta: string; motivo: string }
export type Mapeo = { llenos: Lleno[]; faltantes: Faltante[]; requiere_confirmacion: PorConfirmar[] }

type Coincidencia = { ruta: string; confianza: number; clave: string }

// Busca la ruta del maestro para una etiqueta con el glosario
function buscarEnGlosario(etiqueta: string, glosario: Glosario): Coincidencia | undefined {
  const buscada = normalizar(etiqueta)
  let mejorParcial: Coincidencia | undefined

  for (const [clave, ruta] of Object.entries(glosario)) {
    const claveNormal = normalizar(clave)
    if (claveNormal === buscada) return { ruta, confianza: 1, clave }
    const parcial = claveNormal.length >= 5 && (buscada.includes(claveNormal) || claveNormal.includes(buscada))
    // Entre varias parciales gana la más larga.
    if (parcial && (!mejorParcial || clave.length > mejorParcial.clave.length)) {
      mejorParcial = { ruta, confianza: 0.7, clave }
    }
  }
  return mejorParcial
}

// Cruza cada etiqueta con el maestro
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

    // Motivos para pedir confirmación
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

// Valor por etiqueta, para escribir el formulario
export function valoresPorEtiqueta(mapeo: Mapeo): Map<string, unknown> {
  const valores = new Map<string, unknown>()
  for (const l of mapeo.llenos) valores.set(l.etiqueta, l.valor)
  for (const c of mapeo.requiere_confirmacion) valores.set(c.etiqueta, c.valor)
  return valores
}

// Rutas bancarias
const RUTAS_SENSIBLES = /^banco\./

function enmascarar(valor: unknown): string {
  const texto = String(valor)
  return texto.length > 4 ? `***${texto.slice(-4)}` : "***"
}

// Copia del mapeo con los datos bancarios enmascarados
export function ocultarSensibles(mapeo: Mapeo): Mapeo {
  const ocultar = <T extends { ruta: string; valor: unknown }>(item: T): T =>
    RUTAS_SENSIBLES.test(item.ruta) ? { ...item, valor: enmascarar(item.valor) } : item
  return {
    llenos: mapeo.llenos.map(ocultar),
    faltantes: mapeo.faltantes,
    requiere_confirmacion: mapeo.requiere_confirmacion.map(ocultar),
  }
}

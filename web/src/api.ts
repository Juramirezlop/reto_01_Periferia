// Tipos y llamadas al servidor. Los tipos reflejan lo que devuelven las herramientas.
export type Lleno = { etiqueta: string; ruta: string; valor: unknown }
export type PorConfirmar = Lleno & { confianza: number; nota: string }
export type Faltante = { etiqueta: string; motivo: string }

export type VistaCaso = {
  solicitud: { pais: string; cliente: string; formato: string; campos: { etiqueta: string; obligatorio?: boolean }[]; soportes: string[] }
  mapeo: { llenos: Lleno[]; faltantes: Faltante[]; requiere_confirmacion: PorConfirmar[] }
  estado: { listo_para_firma: boolean; bloqueos: string[]; etapa: string } | null // null = paquete sin armar
  obsoleto: boolean // el estado se calculó con otra fecha de ejecución
  archivos: string[]
}

export type Respuesta = { respuesta: string; herramientas: { nombre: string; ok: boolean }[]; tokens?: number }
export type Salud = { modelo: string; clave: boolean; fecha: string }

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const datos = await r.json()
  if (!r.ok) throw new Error((datos as { error?: string }).error ?? `Error ${r.status}`)
  return datos as T
}

export const obtenerSalud = () => pedir<Salud>("/api/salud")
export const obtenerCasos = () => pedir<string[]>("/api/casos")
export const obtenerCaso = (caso: string) => pedir<VistaCaso>(`/api/caso/${caso}`)
export const urlArchivo = (caso: string, archivo: string) => `/api/archivo/${caso}/paquete/${archivo}`

export const enviarMensaje = (sessionId: string, mensaje: string) =>
  pedir<Respuesta>("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, mensaje }),
  })

export const reiniciar = (sessionId: string) =>
  pedir("/api/reiniciar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) })

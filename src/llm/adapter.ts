// Contrato entre el agente y cualquier modelo

export type DeclaracionHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown> // esquema JSON simplificado
}

// Una petición del modelo para ejecutar una herramienta
export type Llamada = { nombre: string; args: unknown }

// Historial de la conversación en formato neutral
export type Entrada =
  | { tipo: "usuario"; texto: string }
  | { tipo: "modelo"; texto: string; llamadas: Llamada[]; crudo?: unknown }
  | { tipo: "resultado"; nombre: string; contenido: string }

export type RespuestaModelo = { texto: string; llamadas: Llamada[]; crudo?: unknown; tokens?: number }

export type Adaptador = {
  generar(entrada: { sistema: string; historial: Entrada[]; herramientas: DeclaracionHerramienta[] }): Promise<RespuestaModelo>
}

// Error del modelo, si es reintentable se prueba el respaldo
export class ErrorModelo extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean,
  ) {
    super(mensaje)
  }
}

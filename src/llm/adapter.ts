// Contrato entre el agente y CUALQUIER modelo. Si mañana se usa otro proveedor,
// solo se escribe otro archivo que cumpla `Adaptador`; el ciclo del agente no cambia.

// Declaración de una herramienta tal como la ve el modelo.
export type DeclaracionHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown> // esquema JSON simplificado
}

// Una petición del modelo para ejecutar una herramienta.
export type Llamada = { nombre: string; args: unknown }

// Historial de la conversación, en un formato neutral.
export type Entrada =
  | { tipo: "usuario"; texto: string }
  // `crudo` es el mensaje original del proveedor: Gemini 3 exige devolverlo intacto (firmas de razonamiento).
  | { tipo: "modelo"; texto: string; llamadas: Llamada[]; crudo?: unknown }
  | { tipo: "resultado"; nombre: string; contenido: string }

export type RespuestaModelo = { texto: string; llamadas: Llamada[]; crudo?: unknown; tokens?: number }

export type Adaptador = {
  generar(entrada: { sistema: string; historial: Entrada[]; herramientas: DeclaracionHerramienta[] }): Promise<RespuestaModelo>
}

// Error del modelo que justifica probar el modelo de respaldo.
export class ErrorModelo extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean,
  ) {
    super(mensaje)
  }
}

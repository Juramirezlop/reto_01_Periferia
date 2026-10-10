// Fecha fija para que el resultado sea reproducible (lo pide el PRD).
// Para usar la fecha real de hoy, comenta la siguiente línea (o define FECHA_EJECUCION=AAAA-MM-DD en .env).
process.env.FECHA_EJECUCION ||= "2026-09-03"

// Configuración leída de variables de entorno (Bun carga .env automáticamente).
// `||` (y no `??`) para que una variable vacía (LLM_MODEL=) use el valor por defecto.
export const config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  modelo: process.env.LLM_MODEL || "gemini-3.6-flash",
  modeloRespaldo: process.env.LLM_MODEL_RESPALDO || "gemini-3.1-flash-lite",
  puerto: Number(process.env.PORT) || 3000,
}

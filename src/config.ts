// Fecha fija para que el resultado sea reproducible
process.env.FECHA_EJECUCION ||= "2026-09-03"

// Configuración desde variables de entorno
export const config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  modelo: process.env.LLM_MODEL || "gemini-3.6-flash",
  modeloRespaldo: process.env.LLM_MODEL_RESPALDO || "gemini-3.1-flash-lite",
  maxPasos: Number(process.env.MAX_PASOS) || 8, // pasos por mensaje
  maxTokensSesion: Number(process.env.MAX_TOKENS_SESION) || 150_000,
  puerto: Number(process.env.PORT) || 3000,
}

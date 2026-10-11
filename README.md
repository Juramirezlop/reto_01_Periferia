# Agente "Registro como Proveedor" (Reto técnico 01)

Agente conversacional que lee la solicitud de un cliente, llena el formulario desde el repositorio maestro, arma el paquete de soportes para firma y **nunca envía nada sin confirmación humana**.

## Levantar en local (un comando)

Requisitos: [Bun](https://bun.sh) 1.4 o superior.

```bash
bun install
cp .env.example .env      # en PowerShell: copy .env.example .env  ; luego pega tu GEMINI_API_KEY
bun run dev               # backend en :3000 y front en http://localhost:5173
```

La clave se obtiene gratis en [Google AI Studio](https://aistudio.google.com/apikey).

## Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `GEMINI_API_KEY` | Clave del modelo (solo la lee el backend) | — (obligatoria) |
| `LLM_MODEL` / `LLM_MODEL_RESPALDO` | Modelo principal y de respaldo | `gemini-3.6-flash` / `gemini-3.1-flash-lite` |
| `MAX_PASOS` | Máximo de idas y vueltas con el modelo por mensaje | 8 |
| `MAX_TOKENS_SESION` | Tope de tokens por conversación | 150000 |
| `FECHA_EJECUCION` | Fecha para validar vigencias (AAAA-MM-DD) | 2026-09-03 |
| `PORT` | Puerto del servidor | 3000 |

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run dev` | Backend y front con recarga (desarrollo) |
| `bun run build:web` + `bun run start` | Compila el front y lo sirve junto con la API (producción, un solo puerto) |
| `bun run demo` | Corre todas las herramientas sobre los 4 casos, **sin modelo ni clave** |
| `bun run chat` | Chat por terminal con el agente |
| `bun test` | Pruebas automáticas (modelo simulado, sin clave) |
| `bun run typecheck` | Revisa los tipos de backend y front |
| `bun run modelos` | Lista y prueba los modelos disponibles para tu clave |

## Probar el agente

Con el servidor en marcha, en el chat:

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

Resultado esperado con la fecha por defecto (2026-09-03): `co-industrias-delta` y `pa-logistica-istmo` listos; `ec-corp-andina` bloqueado (falta el certificado de cumplimiento tributario); `hn-agroexport-sula` bloqueado (parafiscales vencidos). Los archivos quedan en `out/<caso>/` y se descargan desde el panel "Expediente".

## Link de prueba

URL: _(pendiente de despliegue)_ · Clave de acceso: _(si aplica)_

## Estructura

```
agent/prompt.md            Prompt del agente
src/knowledge/             Conocimiento del proceso (se inyecta al prompt)
src/tools/                 Las 5 herramientas (proveedor.ts) y su lógica determinista
src/llm/                   Adaptador del modelo (adapter.ts) y Gemini (gemini.ts)
src/agent/                 Ciclo del agente, registro de herramientas, sistema
src/server.ts              API (/api/chat, /api/caso/:caso, /api/archivo/...) y front compilado
web/                       Front React + Vite
fixtures/                  Casos, maestro, soportes y glosario (entregados con el reto)
out/                       Resultados generados (no se versiona)
SOLUCION.md                Diseño, decisiones, cobertura y riesgos
```

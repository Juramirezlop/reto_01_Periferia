# SOLUCION.md — Reto técnico 01: agente "Registro como Proveedor"

## 1. Problema en una frase

La analista administrativa de Periferia transcribe a mano, entre 8 y 12 veces al mes, los mismos datos de la empresa en formularios de clientes (Excel, PDF o portal web) y busca a mano los soportes vigentes; este agente prepara el formulario y el paquete para firma, y deja la decisión de enviar a una persona.

## 2. Arquitectura

```
 Navegador (React + Vite)                    Servidor Bun (src/server.ts)
┌────────────────────────────┐   /api/chat   ┌─────────────────────────────────────────┐
│ Casos │ Conversación │ Exp.│ ────────────► │ app.ts: sesión (historial + tokens)     │
│       │  (chat)      │(panel)│             │   └► agent/loop.ts  ◄──► llm/gemini.ts ─┼──► Gemini API
│       │              │     │ ◄──────────── │        │  (ciclo, topes, respaldo)      │    (HTTPS, clave
└────────────────────────────┘  respuesta    │        ▼                                │     solo aquí)
   │  /api/caso/:caso (panel, sin modelo)     │  agent/herramientas.ts (registro + zod) │
   └────────────────────────────────────────► │        ▼                                │
                                              │  tools/proveedor.ts (5 herramientas)    │
                                              │   ├ datos.ts (lee y valida fixtures)    │
                                              │   ├ mapeo.ts (glosario → maestro)       │
                                              │   └ formularios.ts (xlsx / pdf / md)    │
                                              └───────────────┬─────────────────────────┘
                                                              ▼
                              fixtures/ (entrada)         out/<caso>/ (salida: formulario, paquete/,
                                                          estado.json, ENVIO-SIMULADO.md, log.jsonl)
```

| Pieza | Dónde vive |
|---|---|
| Prompt | `agent/prompt.md` |
| Conocimiento del proceso | `src/knowledge/registro-proveedor.md` (se concatena al prompt en `src/agent/sistema.ts`) |
| Ejecución (herramientas) | `src/tools/proveedor.ts`; contrato y validación en `src/tools/util.ts` |
| Ciclo del agente | `src/agent/loop.ts` |
| Modelo | `src/llm/adapter.ts` (contrato) y `src/llm/gemini.ts` (implementación) |

Idea central: **el modelo conversa y decide qué herramienta llamar; el código decide los valores.** El mapeo etiqueta → dato del maestro, la vigencia de los soportes y el estado `listo_para_firma` son código determinista que el modelo no puede alterar.

## 3. Ciclo del agente

`responder()` en `src/agent/loop.ts`, por cada mensaje de la analista:

1. Agrega el mensaje al historial de la sesión.
2. Llama al modelo con el prompt, el historial y las herramientas (esquemas generados desde zod con `z.toJSONSchema`).
3. Si el modelo pide herramientas, las ejecuta y agrega los resultados al historial; vuelve al paso 2. Si responde texto, termina.

Topes y protecciones:
- **Iteraciones:** `MAX_PASOS` (8 por defecto) por mensaje.
- **Tokens:** `MAX_TOKENS_SESION` (150 000 por defecto) por conversación; se suman con `usageMetadata` de Gemini y, al llegar al tope, el agente deja de llamar al modelo.
- **Timeout y respaldo:** 20 s por llamada. Si el modelo principal agota el tiempo, devuelve 429 o 5xx, se prueba el modelo de respaldo. Los errores que no se arreglan con otro modelo (clave inválida, 403, 404) se informan sin reintentar.
- **Confirmación humana (RN4), aplicada en código y no solo en el prompt:** `simular_envio` recibe `confirmado` desde el código (`agent/herramientas.ts`), nunca del modelo. Solo es `true` si el mensaje de la analista confirma ("confirmo", "envíalo", o un "sí" justo después de que el agente pidió confirmación) y no contiene "no". Sin confirmación la herramienta responde `requiere confirmación explícita`.
- **Errores:** ninguna herramienta lanza; `definirHerramienta` valida con zod, captura excepciones y devuelve `{ ok, data }` o `{ ok: false, error }` (HU-5). Cada llamada queda en `out/log.jsonl` y en `out/<caso>/log.jsonl` (RN5).
- **Datos sensibles:** `mapear_campos` enmascara los datos bancarios antes de devolverlos al modelo (`***2345`); el valor real solo se escribe en el archivo generado (RN2). El cuerpo del correo del cliente no se entrega al modelo, lo que reduce el riesgo de inyección de instrucciones desde una solicitud.

## 4. Elección del modelo

- **Proveedor:** Google AI Studio (API de Gemini, nivel gratuito). Se buscó una opción sin costo.
- **Modelos:** `gemini-3.6-flash` (principal) y `gemini-3.1-flash-lite` (respaldo).
- **Por qué:** se probaron con una llamada de herramienta, 3 veces cada uno (`bun run modelos`). `gemini-3.6-flash` fue el más estable; `gemini-3.8-flash` y `gemini-3.1-flash-lite` tuvieron picos de 15 a 30 s, por eso el timeout de 20 s y el respaldo. `gemini-2.5-flash` ya no está disponible para cuentas nuevas.
- **Suscripción vs API:** la suscripción Google AI Pro no sube los límites de la API; solo habilitar facturación (Tier 1) lo hace.
- **Costo por caso:** en el nivel gratuito, 0. El consumo real se mide con los tokens que reporta cada respuesta (`bun run chat` los imprime). Para estimar el costo en un plan de pago: `tokens por caso × precio por token del modelo`. **Pendiente: anotar aquí el consumo medido de un caso completo.** _(Medición: ____ tokens por caso.)_
- **Privacidad:** en el nivel gratuito Google puede usar los prompts para mejorar sus productos; por eso solo se usan datos ficticios. Para producción se usaría un plan de pago.

## 5. Diseño del portal web (sección 7.4 del PRD)

**Lo que sí hace hoy:** para un caso con formato `portal` la herramienta responde `formato no soportado` y escribe `out/<caso>/valores-portal.md` con una tabla etiqueta → valor para copiar. El paquete queda en etapa "carga en portal" (no hay firma); la lista de adjuntos excluye ese archivo porque puede llevar datos bancarios.

**Cómo se automatizaría:**
- **Estrategia:** un navegador controlado por el agente (Playwright o una extensión de navegador que opera sobre la sesión abierta de la analista) que recorre el portal y llena campos usando solo los valores del mapeo. Frente a RPA clásico tiene la ventaja de que se adapta mejor a cambios de layout (localiza campos por etiqueta, no por posición); frente a una extensión, la ventaja de correr aislado.
- **Límites:** CAPTCHA, MFA y cambios de layout rompen la automatización. Ante cualquiera de ellos el agente se detiene y entrega los valores en `valores-portal.md`, que es lo que ya hace hoy. Los portales con MFA se operan siempre de forma manual.
- **Credenciales:** nunca en el repositorio, en el prompt ni en logs. Viven en un gestor de secretos (por ejemplo variables del entorno de despliegue o un vault) y las **ingresa la analista** en el navegador; el agente nunca las ve. El log solo registra el resultado de cada acción, no los valores de campos sensibles.
- **Reparto:** el agente abre el portal, llena campos y deja una captura de lo llenado. **Humano:** ingresar las credenciales, resolver CAPTCHA/MFA, revisar y hacer clic en "Enviar". El clic final es siempre humano (RN4).

## 6. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **Mapeo determinista en código** (glosario → maestro, confianza 1.0 exacta, 0.7 parcial → por confirmar) | Que el modelo mapee los campos | El PRD prohíbe inventar valores; con código cada valor es trazable. Costo: lo que no está en el glosario es `faltante`, aunque una persona lo reconocería. |
| **Bun** como runtime (TypeScript nativo, servidor y pruebas en un solo programa) | Node + tsx/vitest, o Docker Compose | Menos piezas y arranque más rápido. El PRD acepta `bun run dev` o `docker compose up`. Costo: Bun es menos conocido y su despliegue es menos estándar. |
| **Adaptador propio con `fetch`** sobre `generateContent` de Gemini | SDK oficial; Interactions API (la que Google recomienda ahora) | Control explícito de timeout, respaldo y firmas de razonamiento de Gemini 3 en ~100 líneas legibles. Costo: hay que mantener la compatibilidad con la API; una migración a Interactions API queda pendiente. |
| **Confirmación aplicada en código** | Confiar en el prompt | Un prompt puede ignorarse; el código no. Costo: la detección de "confirmo" es por patrones y es conservadora (ante la duda, pide confirmar). |
| **Sin base de datos** (sesiones y resultados en memoria y en `out/`) | PostgreSQL en Railway | El PRD no la pide. Costo: se pierden las conversaciones al reiniciar. |
| **Front React + Vite** con un expediente calculado sin el modelo | Un HTML simple | Permite ver el estado real del caso aunque el modelo falle y descargar los archivos sin acceso al disco del servidor. |

## 7. Supuestos

- Los fixtures ya traen la plantilla extraída a JSON (`plantilla-celdas.json`, `plantilla-campos.json`); no se lee ni se hace OCR de un .xlsx o .pdf real del cliente.
- La fecha de ejecución por defecto es la del PRD (2026-09-03) para que el resultado sea reproducible; se cambia con `FECHA_EJECUCION` o comentando la línea de `src/config.ts`.
- Un soporte con `vigencia_hasta` igual a la fecha de ejecución se considera vigente; solo uno anterior está vencido.
- En un caso `portal`, "listo" significa listo para cargar en portal (no hay firma). Esa lectura es mía; el PRD no la define.
- Los datos bancarios van en `valores-portal.md` cuando la plantilla los pide (RN2), pero ese archivo no se adjunta al correo.
- El NIT no se trata como dato sensible; solo lo bancario.
- "Confirmación en el turno inmediatamente anterior" (RN4) se interpreta como el mensaje actual de la analista.

## 8. Cobertura

| Ítem | Estado | Evidencia |
|---|---|---|
| HU-1 Leer la solicitud (campos, país, formato, soportes, ambiguos con propuesta) | Hecho | `proveedor_leer_solicitud`; `bun run demo` |
| HU-2 Mapear al maestro (lleno / faltante / por confirmar; glosario) | Hecho | `src/tools/mapeo.ts`; demo (EC: RUC por confirmar, "contribuyente especial" faltante) |
| HU-3 Excel (celdas exactas) | Hecho | `formulario.xlsx` de CO y HN |
| HU-3 PDF (todos los campos en orden) | Hecho | `formulario.pdf` de EC |
| HU-3 Portal (`formato no soportado` + `valores-portal.md`) | Hecho | PA; prueba automática |
| HU-4 Paquete (formulario, soportes, checklist, borrador de correo, vencidos bloquean) | Hecho | `out/<caso>/paquete/`; `estado.json` |
| HU-4 Resumen y pregunta de confirmación; envío solo escribe `ENVIO-SIMULADO.md` | Hecho | prompt + `simular_envio`; pruebas |
| HU-5 Errores sin excepción (caso inexistente, plantilla corrupta, argumentos inválidos) | Hecho | pruebas automáticas |
| RN1 Identificador por país y nota "identificador extranjero" | Hecho | HN (RTN), PA (RUC), EC (RUC) |
| RN2 Banco solo si la plantilla lo pide; nunca en el correo | Hecho | prueba de enmascarado; `borrador-correo.md` |
| RN3 Vencido o ausente bloquea; faltante no | Hecho | demo (EC y HN bloqueados) |
| RN4 Confirmación explícita antes de cualquier acción externa | Hecho (en código) | pruebas de `confirmaEnvio` y de `ejecutar` |
| RN5 Registro en `out/<caso>/log.jsonl` | Hecho | `util.ts` |
| Arranque con un comando (`bun run dev`) | Hecho | probado |
| `demo.ts` determinista, sin clave, `out/` limpia al inicio | Hecho | `bun run demo` |
| Seguridad: clave solo en el backend; sin shell en herramientas | Hecho | la clave va en un header y no se registra |
| Costo: topes de iteraciones y de tokens configurables | Hecho | `.env.example`; pruebas |
| Robustez: timeout con mensaje claro, un caso malo no frena al siguiente | Hecho | `gemini.ts`; demo |
| Legibilidad: TypeScript sin `any` | Hecho | `bun run typecheck` |
| Link público de prueba | **No hecho** | pendiente: Railway |
| Bonus `modulo/` | **No hecho** | opcional |
| Diseño del portal (sección 5) | Hecho (documentado) | este archivo |

**Qué falta para producción:** leer plantillas reales (.xlsx, .pdf, OCR) en vez de JSON ya extraído; autenticación en el link público y límites por usuario; guardar sesiones y resultados en un almacenamiento persistente (en Railway el disco se borra al redeplegar); un plan de pago del modelo; firma electrónica (fase posterior); un dueño del dato para mantener al día el maestro y los soportes.

## 9. Uso de IA

- **Claude (Anthropic, en una sesión de Claude Code):** escribió el código y esta documentación siguiendo el análisis y las decisiones de Juan David. Juan revisó cada entrega, la ejecutó en su máquina y reportó los fallos que Claude corrigió.
- **Gemini (Google):** es el modelo que usa el agente en tiempo de ejecución.
- **Qué se descartó de lo propuesto:** `gemini-3.8-flash` y `gemini-3.1-flash-lite` como principal (picos de latencia); un paquete de portal que decía "formulario firmado" y adjuntaba datos bancarios (se corrigió); depender del prompt para la confirmación (se movió al código); Docker (no hacía falta). _Juan: agrega aquí lo que tú descartaste o cambiaste por tu cuenta._
- **Qué se verificó a mano:** las salidas de `bun run demo`, los archivos generados (celdas del Excel, campos del PDF) y las respuestas reales del chat contra los fixtures.

## 10. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo inventa un valor | Los valores salen solo de las herramientas; el prompt prohíbe valores fuera del mapeo; el panel "Expediente" muestra los valores reales sin pasar por el modelo |
| Plantillas reales peores que las de prueba | Añadir lectura real de xlsx/pdf con revisión humana de lo extraído |
| Maestro o soportes desactualizados | Asignar un dueño del dato y alertar vigencias próximas a vencer |
| Gasto de la clave desde un link público | Topes por sesión (ya hechos); falta autenticación y límite por usuario |
| Nivel gratuito: límites de uso y uso de prompts por Google | Pasar a un plan de pago antes de usar datos reales |
| Portales con CAPTCHA o MFA | El humano opera el portal; el agente solo prepara los valores |
| Se pierden resultados al redeplegar (disco efímero) | Almacenamiento persistente (volumen o almacenamiento de objetos) |
| Cambios en la API de Gemini (formato de herramientas, Interactions API) | Adaptador aislado en `src/llm/`; pruebas con respuestas simuladas |

---

## Anexo: bitácora de construcción

1. **Lectura del PRD** y análisis de entregables antes de tocar código; decisiones de stack (Bun, TypeScript, zod, Gemini).
2. **Fixtures y herramientas** (`datos`, `mapeo`, `formularios`, `proveedor`): primero determinista y probado con `demo.ts` sin modelo.
3. **Corrección del paquete de portal:** el correo decía "formulario firmado" y adjuntaba `valores-portal.md` con datos bancarios; el estado decía "listo para firma". Se corrigió con una etapa `carga en portal`.
4. **Fecha de ejecución:** se fijó en 2026-09-03 para que el demo sea reproducible; después también en el chat y el servidor.
5. **Elección del modelo:** prueba empírica de tres modelos y diseño de timeout y respaldo.
6. **Agente:** adaptador de Gemini, ciclo, confirmación en código, enmascarado de datos bancarios y pruebas con modelo simulado.
7. **Front:** casos, chat y expediente calculado sin el modelo.
8. **Hallazgos al probar:** el panel mostraba estados viejos de otra fecha (ahora `estado.json` guarda su fecha y el panel avisa); un `useEffect` devolvía un valor y rompía la pantalla (`destroy is not a function`); un test dependía de que `out/` ya tuviera un paquete (ahora lo arma él).
9. **Cierre contra el PRD:** se detectaron dos requisitos incompletos (un solo comando para front y backend, y tope de tokens por sesión) y se corrigieron.

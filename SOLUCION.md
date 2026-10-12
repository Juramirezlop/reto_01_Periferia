# Solución al reto 01: agente "Registro como Proveedor"

## 1. El problema

La analista administrativa de Periferia pasa buena parte del mes copiando a mano los mismos datos de la empresa en formularios de distintos clientes (Excel, PDF o portales web) y buscando cada soporte para ver si sigue vigente. Son entre 8 y 12 formularios al mes y el conocimiento de qué pide cada país está en la cabeza de una sola persona.

Construí un agente que lee la solicitud, llena el formulario desde el repositorio maestro, arma el paquete de soportes y deja todo listo para la firma. El agente nunca firma ni envía: eso lo decide una persona.

## 2. Arquitectura

```mermaid
flowchart LR
    A[Navegador<br/>React + Vite] -->|/api/chat| B[Servidor Bun]
    A -->|/api/caso y /api/archivo| B
    B --> C[Ciclo del agente]
    C <-->|HTTPS| D[Gemini API]
    C --> E[5 herramientas<br/>con zod]
    E --> F[(fixtures<br/>entrada)]
    E --> G[(out/caso<br/>salida)]
```

El panel de la derecha de la pantalla (el expediente) no usa el modelo: llama directamente a las herramientas, así que siempre muestra el estado real del caso aunque Gemini falle. Al arrancar, el servidor arma los paquetes que falten o que se hayan calculado con otra fecha (`src/preparar.ts`), con las mismas herramientas, para que el panel no quede vacío y no haya que correr el demo antes.

Dónde vive cada cosa:

- El prompt está en `modulo/agent.md` (sus metadatos son los que pide el PRD; `src/agent/sistema.ts` los quita antes de enviarlo al modelo).
- El conocimiento del proceso está en `modulo/skill/registro-proveedor/SKILL.md` y se une al prompt en `src/agent/sistema.ts`.
- Las herramientas están en `modulo/tools/proveedor.ts`. Leer los archivos, mapear los campos y generar los formularios están en `datos.ts`, `mapeo.ts` y `formularios.ts`, en la misma carpeta.
- El ciclo del agente está en `src/agent/loop.ts`.
- La conexión con el modelo está en `src/llm/` (un contrato en `adapter.ts` y la implementación de Gemini en `gemini.ts`).

La idea central es que el modelo conversa y decide qué herramienta llamar, pero los valores los decide el código. El mapeo de cada etiqueta al maestro, la vigencia de los soportes y el estado "listo para firma" son código determinista que el modelo no puede cambiar.

## 3. Ciclo del agente

```mermaid
flowchart TD
    M[Mensaje de la analista] --> T{¿Se pasó el tope<br/>de tokens?}
    T -->|sí| X[Responde que la conversación<br/>llegó a su límite]
    T -->|no| L[Llama al modelo<br/>20 s de espera, con respaldo]
    L --> Q{¿Pide herramientas?}
    Q -->|no| R[Respuesta final]
    Q -->|sí| H[Ejecuta las herramientas<br/>y guarda los resultados]
    H --> P{¿Se pasó el tope<br/>de pasos?}
    P -->|no| T
    P -->|sí| Y[Corta y avisa]
```

Por cada mensaje, `responder()` agrega el mensaje al historial, llama al modelo con el prompt y las herramientas, ejecuta lo que el modelo pida y vuelve a llamarlo hasta que responda con texto.

Los topes y las protecciones:

- Pasos: `MAX_PASOS` (8 por defecto) idas y vueltas por mensaje.
- Tokens: `MAX_TOKENS_SESION` (150 000 por defecto) por conversación. Se suman con lo que Gemini reporta en cada respuesta; al llegar al tope el agente deja de llamar al modelo.
- Timeout y respaldo: 20 segundos por llamada. Si el modelo principal se demora, devuelve 429 o un error 5xx, se prueba el modelo de respaldo. Los errores que otro modelo no arregla (clave inválida, 403, 404) se informan sin reintentar.
- Llamadas repetidas: si el modelo pide exactamente la misma herramienta con los mismos argumentos dentro del mismo mensaje, se reutiliza el resultado.
- La confirmación humana está en el código, no solo en el prompt. A `simular_envio` el valor de `confirmado` lo pone el código, nunca el modelo, y solo es verdadero si el mensaje de la analista confirma ("confirmo", "envíalo", o un "sí" justo después de que el agente pidió confirmación) y no contiene un "no". Sin eso la herramienta responde "requiere confirmación explícita".
- Los errores no rompen nada: cada herramienta valida sus argumentos con zod, atrapa las excepciones y devuelve `{ ok, data }` o `{ ok: false, error }`. Cada llamada queda en `out/log.jsonl` y en `out/<caso>/log.jsonl`.
- Los datos bancarios se enmascaran (`***2345`) antes de llegar al modelo; el valor real solo se escribe en el archivo generado. El cuerpo del correo del cliente tampoco se le entrega, lo que reduce el riesgo de que una solicitud traiga instrucciones escondidas.

## 4. Elección del modelo

Uso Google AI Studio (API de Gemini en el nivel gratuito), con `gemini-3.6-flash` como principal y `gemini-3.1-flash-lite` como respaldo. Quería una opción sin costo.

Los probé con una llamada de herramienta, tres veces cada uno (`bun run modelos`). El 3.6 fue el más estable. El 3.8 y el 3.1-lite tuvieron picos de 15 a 30 segundos, y por eso el timeout de 20 segundos y el respaldo. El `gemini-2.5-flash` ya no está disponible para cuentas nuevas.

Otra cosa que aprendí: la suscripción Google AI Pro no sube los límites de la API; solo habilitar facturación lo hace.

Costo por caso: en el nivel gratuito es cero. Para estimar el costo en un plan de pago hay que medir los tokens por caso, y `bun run chat` los imprime al final de cada respuesta. Una consulta general, sin procesar ningún caso, gastó 8 526 tokens en total (cada paso del ciclo vuelve a enviar el historial). Falta anotar la medición de un caso completo: ____ tokens.

Privacidad: en el nivel gratuito Google puede usar los prompts para mejorar sus productos. Por eso en el reto solo hay datos ficticios; para datos reales usaría un plan de pago.

## 5. Diseño del portal web

Lo que ya hace hoy: para un caso con formato portal la herramienta responde "formato no soportado" y escribe `out/<caso>/valores-portal.md` con una tabla etiqueta y valor para copiar. El paquete queda en etapa "carga en portal" (no hay firma) y el correo no adjunta ese archivo, porque puede llevar datos bancarios.

Cómo lo automatizaría:

```mermaid
flowchart LR
    A[Agente: prepara los valores<br/>y el paquete] --> B[Analista abre el portal<br/>e ingresa sus credenciales]
    B --> C[Agente llena los campos<br/>con el navegador controlado]
    C -->|CAPTCHA, MFA o cambio<br/>de pantalla| D[Se detiene: la analista<br/>copia desde valores-portal.md]
    C --> E[Captura de lo llenado]
    E --> F[Analista revisa<br/>y hace clic en Enviar]
    D --> F
```

- Estrategia: un navegador controlado por el agente (Playwright, o una extensión que opere sobre la sesión abierta de la analista). Frente a un RPA clásico se adapta mejor a cambios de diseño, porque busca los campos por su etiqueta y no por su posición.
- Límites: un CAPTCHA, un MFA o un cambio fuerte de la pantalla rompen la automatización. En cualquiera de esos casos el agente se detiene y la analista copia desde `valores-portal.md`, que es lo que ya existe. Los portales con MFA se operan siempre a mano.
- Credenciales: nunca van en el repositorio, en el prompt ni en los logs. Viven en un gestor de secretos y las ingresa la analista en el navegador; el agente nunca las ve.
- Reparto: el agente llena campos y deja una captura. La analista ingresa las credenciales, resuelve CAPTCHA o MFA, revisa y hace clic en "Enviar". Ese último clic es siempre humano.

## 6. Decisiones y alternativas descartadas

1. Mapeo en código y no con el modelo. Cada etiqueta se cruza con el maestro mediante el glosario: coincidencia exacta es confianza 1.0 y coincidencia parcial es 0.7 y queda por confirmar. Descarté dejar que el modelo mapee porque el PRD prohíbe inventar valores y con código cada valor es trazable. El costo es que lo que no está en el glosario es "faltante", aunque una persona lo reconocería.
2. Bun como runtime. Corre TypeScript directo y trae servidor y pruebas en un solo programa. Descarté Node con tsx y vitest, y también Docker Compose, por tener menos piezas. El costo es que Bun es menos conocido y su despliegue es menos estándar.
3. Un adaptador propio con `fetch` sobre `generateContent` de Gemini. Descarté el SDK oficial y la Interactions API (la que Google recomienda hoy) porque así controlo el timeout, el respaldo y las firmas de razonamiento de Gemini 3 en unas cien líneas. El costo es que yo mantengo la compatibilidad; migrar a Interactions API queda pendiente.
4. Confirmación aplicada en el código. Descarté confiar solo en el prompt porque un prompt se puede ignorar. El costo es que detectar "confirmo" por patrones es conservador: ante la duda, el agente vuelve a pedir confirmación.
5. Sin base de datos, tal como pide el PRD. Las sesiones viven en memoria y los resultados en `out/`. Se pierden al reiniciar el servidor.
6. El módulo exportable (`modulo/`) es la fuente de verdad y la app lo usa: el prompt, el conocimiento y las herramientas viven ahí y el servidor los importa o los lee desde ahí. Descarté mantener una copia aparte para el módulo porque las dos se desfasarían. El costo es que la app depende de esa carpeta.
7. Un front en React con el expediente calculado sin el modelo, en lugar de un HTML simple. Así se ve el estado real del caso aunque el modelo falle y la analista descarga los archivos sin tener acceso al disco del servidor.

## 7. Supuestos

- Los fixtures ya traen la plantilla extraída a JSON. No leo ni hago OCR de un .xlsx o .pdf real del cliente.
- La fecha de ejecución por defecto es la del PRD (2026-09-03), para que el resultado sea reproducible. Se cambia con `FECHA_EJECUCION` o comentando la línea de `src/config.ts`.
- Un soporte cuya vigencia es igual a la fecha de ejecución se considera vigente; solo uno anterior está vencido.
- En un caso de portal, "listo" significa listo para cargar en el portal, porque no hay firma. El PRD no lo define; es mi lectura.
- Los datos bancarios van en `valores-portal.md` cuando la plantilla los pide (regla RN2), pero ese archivo no se adjunta al correo.
- El NIT no lo trato como dato sensible; solo lo bancario.
- Entiendo "confirmación en el turno inmediatamente anterior" (RN4) como el mensaje actual de la analista.

## 8. Cobertura

| Historia o requisito | Estado | Dónde se comprueba |
|---|---|---|
| HU-1 Leer la solicitud | Hecho | `bun run demo`, herramienta `leer_solicitud` |
| HU-2 Mapear al maestro | Hecho | `mapeo.ts`, demo (en Ecuador el RUC queda por confirmar) |
| HU-3 Excel, PDF y portal | Hecho | `formulario.xlsx` (CO, HN), `formulario.pdf` (EC), `valores-portal.md` (PA) |
| HU-4 Paquete para firma | Hecho | `out/<caso>/paquete/`, `estado.json` |
| HU-4 Pregunta de confirmación y envío simulado | Hecho | prompt, `simular_envio` y pruebas |
| HU-5 Errores controlados | Hecho | pruebas automáticas |
| RN1 a RN5 | Hecho | pruebas y demo |
| Un comando para arrancar | Hecho | `bun run dev` |
| `demo.ts` determinista y sin clave | Hecho | `bun run demo` |
| Seguridad de la clave | Hecho | solo en el backend, por header, fuera de logs y respuestas |
| Topes de pasos y de tokens | Hecho | `.env.example`, pruebas |
| Timeout y un caso malo no frena al siguiente | Hecho | `gemini.ts`, demo |
| TypeScript sin `any` | Hecho | `bun run typecheck` |
| Link público de prueba | No hecho | falta el despliegue |
| Bonus `modulo/` | Hecho | `modulo/agent.md`, `modulo/tools/`, `modulo/skill/`; pruebas de que la app usa los mismos archivos |

Lo que falta para producción: leer plantillas reales (.xlsx, .pdf, OCR) en lugar de JSON ya extraído, autenticación y límites por usuario en el link público, guardar sesiones y resultados en un almacenamiento persistente (el disco de la nube se borra al redesplegar), un plan de pago del modelo, la firma electrónica en una fase posterior, y un responsable de mantener al día el maestro y los soportes.

## 9. Uso de IA

Usé Claude (de Anthropic, en una sesión de Claude Code) para escribir el código y esta documentación. Yo definí qué se hacía y por qué, revisé cada entrega, la corrí en mi máquina y reporté los fallos que se corrigieron. El agente usa Gemini (de Google) como modelo en tiempo de ejecución.

De lo que se propuso descarté o cambié:

- `gemini-3.8-flash` y `gemini-3.1-flash-lite` como modelo principal, por los picos de latencia.
- Un paquete de portal que decía "formulario firmado" y adjuntaba datos bancarios; se corrigió.
- Depender del prompt para la confirmación del envío; se pasó al código.
- Docker, que no hacía falta.

Escribe aquí lo que tú descartaste o cambiaste por tu cuenta: ____

Lo que verifiqué a mano: la salida de `bun run demo`, los archivos generados (celdas del Excel y campos del PDF) y las respuestas reales del chat contra los fixtures.

## 10. Riesgos

| Riesgo | Cómo lo mitigaría |
|---|---|
| El modelo inventa un valor | Los valores salen solo de las herramientas, el prompt prohíbe valores fuera del mapeo y el expediente muestra los valores reales sin pasar por el modelo |
| Plantillas reales peores que las de prueba | Leer xlsx y pdf reales, con revisión humana de lo extraído |
| Maestro o soportes desactualizados | Un responsable del dato y alertas de vigencias por vencer |
| Gasto de la clave desde un link público | Los topes por sesión ya están; falta autenticación y un límite por usuario |
| Límites del nivel gratuito y uso de prompts por Google | Pasar a un plan de pago antes de usar datos reales |
| Portales con CAPTCHA o MFA | Opera la analista; el agente solo prepara los valores |
| Se pierden resultados al redesplegar | Almacenamiento persistente (volumen o almacenamiento de objetos) |
| Cambios en la API de Gemini | Adaptador aislado en `src/llm/` y pruebas con respuestas simuladas |

## Anexo: cómo se construyó

1. Leí el PRD y analicé los entregables antes de escribir código; elegí el stack (Bun, TypeScript, zod, Gemini).
2. Hice primero las herramientas deterministas y las probé con `demo.ts`, sin modelo.
3. Corregí el paquete de portal: el correo decía "formulario firmado", adjuntaba datos bancarios y el estado decía "listo para firma".
4. Fijé la fecha de ejecución en 2026-09-03 para que el demo sea reproducible, y después también en el chat y el servidor.
5. Probé tres modelos y diseñé el timeout y el respaldo.
6. Construí el agente: adaptador de Gemini, ciclo, confirmación en el código, enmascarado de datos bancarios y pruebas con un modelo simulado.
7. Hice el front: casos, chat y expediente calculado sin el modelo.
8. Al probar encontré tres cosas. El panel mostraba estados viejos calculados con otra fecha (ahora `estado.json` guarda su fecha y el panel avisa). Un `useEffect` devolvía un valor y rompía la pantalla. Un test dependía de que `out/` ya tuviera un paquete. También el agente repetía llamadas iguales y no sabía explicar cómo se envía un caso de portal; ahora reutiliza resultados y tiene esa parte en su conocimiento.
9. Armé el módulo exportable moviendo el prompt, el conocimiento y las herramientas a `modulo/`, y haciendo que la app los use desde ahí. También hice que el servidor prepare los casos al arrancar, porque sin eso había que correr `bun run demo` antes de ver el panel completo, y recorté los comentarios del código a una línea cada uno.
10. Revisé el PRD punto por punto y completé dos requisitos que faltaban: un solo comando para front y backend, y el tope de tokens por sesión.

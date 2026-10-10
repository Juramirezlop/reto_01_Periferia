import { useCallback, useEffect, useRef, useState } from "react"
import { enviarMensaje, obtenerCaso, obtenerCasos, obtenerSalud, reiniciar, type Salud, type VistaCaso } from "./api"
import { Chat, type Mensaje } from "./Chat"
import { Expediente } from "./Expediente"
import { Ventana } from "./Ventana"

type Vista = "casos" | "chat" | "expediente" // en pantallas pequeñas se muestra una sola

export function App() {
  const sessionId = useRef(crypto.randomUUID()).current
  const [salud, setSalud] = useState<Salud | null>(null)
  const [casos, setCasos] = useState<string[]>([])
  const [vistas, setVistas] = useState<Record<string, VistaCaso>>({})
  const [activo, setActivo] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [vista, setVista] = useState<Vista>("chat")
  const [enfocarChat, setEnfocarChat] = useState(false)

  // Trae (o refresca) la vista de un caso. Si el servidor falla, se conserva la anterior.
  const cargarCaso = useCallback(async (caso: string) => {
    try {
      const v = await obtenerCaso(caso)
      setVistas((previas) => ({ ...previas, [caso]: v }))
    } catch {}
  }, [])

  useEffect(() => {
    obtenerSalud().then(setSalud).catch(() => setSalud(null))
    obtenerCasos()
      .then((lista) => {
        setCasos(lista)
        setActivo(lista[0] ?? null)
        lista.forEach(cargarCaso)
      })
      .catch(() => {})
  }, [cargarCaso])

  async function enviar(texto: string) {
    if (trabajando) return
    setMensajes((m) => [...m, { rol: "usuario", texto }])
    setTrabajando(true)
    try {
      const r = await enviarMensaje(sessionId, texto)
      setMensajes((m) => [...m, { rol: "agente", texto: r.respuesta, herramientas: r.herramientas }])
    } catch (e) {
      setMensajes((m) => [...m, { rol: "agente", texto: `No pude hablar con el servidor: ${e instanceof Error ? e.message : e}`, herramientas: [], error: true }])
    }
    setTrabajando(false)
    casos.forEach(cargarCaso) // el agente pudo armar paquetes: se refresca el expediente
  }

  async function nueva() {
    await reiniciar(sessionId).catch(() => {})
    setMensajes([])
  }

  const vistaActiva = activo ? vistas[activo] : undefined

  return (
    <div className={`escritorio vista-${vista}${enfocarChat ? " enfocado" : ""}`}>
      <header className="cabecera">
        <h1>Registro de proveedores</h1>
        <p className="estado-sistema">
          <span className={`punto ${salud?.clave ? "ok" : "falla"}`} />
          {salud ? (salud.clave ? salud.modelo : "falta GEMINI_API_KEY en .env") : "servidor sin conexión"}
          {salud && <span className="fecha">fecha de ejecución {salud.fecha}</span>}
        </p>
      </header>

      <main className="ventanas">
        <Ventana titulo="Casos" clase="v-casos">
          <ul className="lista-casos">
            {casos.map((c) => {
              const v = vistas[c]
              const estado = !v ? "cargando" : !v.estado ? "sin-armar" : v.estado.listo_para_firma ? "listo" : "bloqueado"
              return (
                <li key={c}>
                  <button className={`caso ${c === activo ? "activo" : ""}`} onClick={() => { setActivo(c); setVista("expediente") }}>
                    <span className="pais">{v?.solicitud.pais ?? "··"}</span>
                    <span className="caso-texto">
                      <strong>{v?.solicitud.cliente ?? c}</strong>
                      <small>formato {v?.solicitud.formato ?? "…"}</small>
                    </span>
                    <span className={`marca ${estado}`} title={estado.replace("-", " ")} />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="leyenda">
            <span className="marca listo" /> listo <span className="marca bloqueado" /> bloqueado <span className="marca sin-armar" /> sin armar
          </p>
        </Ventana>

        <Ventana
          titulo="Conversación"
          clase="v-chat"
          acciones={
            <>
              <button onClick={nueva} title="Nueva conversación">↺</button>
              <button onClick={() => setEnfocarChat((e) => !e)} title={enfocarChat ? "Mostrar todo" : "Ampliar chat"}>{enfocarChat ? "⤡" : "⤢"}</button>
            </>
          }
        >
          <Chat mensajes={mensajes} trabajando={trabajando} caso={activo} vista={vistaActiva} onEnviar={enviar} />
        </Ventana>

        <Ventana titulo={activo ? `Expediente · ${activo}` : "Expediente"} clase="v-expediente">
          {activo && vistaActiva ? <Expediente caso={activo} vista={vistaActiva} /> : <p className="vacio">Elige un caso para ver su expediente.</p>}
        </Ventana>
      </main>

      <nav className="pestanas">
        {(["casos", "chat", "expediente"] as Vista[]).map((v) => (
          <button key={v} className={v === vista ? "activa" : ""} onClick={() => setVista(v)}>
            {v === "chat" ? "conversación" : v}
          </button>
        ))}
      </nav>
    </div>
  )
}

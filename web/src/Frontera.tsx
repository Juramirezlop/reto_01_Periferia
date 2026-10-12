import { Component, type ReactNode } from "react"

// Muestra el error si algo falla al dibujarse, en vez de dejar la pantalla en blanco.
export class Frontera extends Component<{ children: ReactNode; alternativa?: (error: Error) => ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error("Error al dibujar:", error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.alternativa) return this.props.alternativa(error)
    return (
      <div className="falla-pantalla" role="alert">
        <h2>La pantalla falló al dibujarse</h2>
        <pre>{error.message}</pre>
        <button onClick={() => location.reload()}>Recargar</button>
      </div>
    )
  }
}

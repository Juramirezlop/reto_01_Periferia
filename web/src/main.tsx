import { createRoot } from "react-dom/client"
import { App } from "./App"
import { Frontera } from "./Frontera"
import "./estilos.css"

createRoot(document.getElementById("root")!).render(
  <Frontera>
    <App />
  </Frontera>,
)

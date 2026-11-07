import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const missingBridge = (
  <div className="boot">
    <div className="boot-mark">L</div>
    <p>Lantern opens as a desktop application. Start it with the project's launch command rather than a browser.</p>
  </div>
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{window.lantern ? <App /> : missingBridge}</React.StrictMode>,
);
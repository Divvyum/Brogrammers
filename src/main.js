import { app } from "./firebase.js";

document.querySelector("#app").textContent = `Firebase connected: ${app.options.projectId}`;

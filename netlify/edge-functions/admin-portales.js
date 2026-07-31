// netlify/edge-functions/admin-portales.js
//
// Panel de administración en https://creas.ciemx.com/admin-portales
// Aquí puedes dar de alta o quitar usuarios/contraseñas de los 3 portales
// SIN entrar a Netlify y SIN necesidad de un nuevo deploy. Los cambios se
// aplican al instante.
//
// Protegido con una sola contraseña maestra, guardada en Netlify como
// variable de entorno: ADMIN_PASSWORD (esa sí se configura una sola vez
// en Netlify -> Site configuration -> Environment variables).

import { getStore } from "@netlify/blobs";

const PORTALS = [
  { key: "ALUMNOS", label: "Alumnos" },
  { key: "FAMILIAS", label: "Familias" },
  { key: "DOCENTES", label: "Docentes" },
];

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function randomSaltHex(len = 16) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #f4f5f7;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    color: #1b2332;
  }
  .center {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0f1f3d 0%, #1b2f57 100%);
  }
  .card {
    background: #fff;
    border-radius: 14px;
    padding: 40px 36px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.35);
  }
  .card h1 {
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #c9a227;
    margin: 0 0 4px;
    text-align: center;
  }
  .card h2 {
    font-size: 20px;
    color: #0f1f3d;
    margin: 0 0 24px;
    text-align: center;
  }
  input {
    width: 100%;
    padding: 11px 12px;
    border: 1px solid #d5d5d5;
    border-radius: 8px;
    font-size: 15px;
    margin-top: 6px;
  }
  input:focus { outline: none; border-color: #c9a227; }
  button {
    padding: 11px 16px;
    border: none;
    border-radius: 8px;
    background: #0f1f3d;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #16305e; }
  button.danger { background: #b3261e; padding: 7px 12px; font-size: 13px; }
  button.danger:hover { background: #8f1e18; }
  button.link { background: none; color: #0f1f3d; text-decoration: underline; padding: 0; }
  .error {
    background: #fdecea; color: #b3261e; padding: 10px 12px;
    border-radius: 8px; font-size: 13px; margin-top: 16px; text-align: center;
  }
  .msg {
    background: #e8f5e9; color: #1e5c22; padding: 10px 16px;
    border-radius: 8px; font-size: 14px; max-width: 900px; margin: 0 auto 20px;
  }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 60px; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px;
  }
  .topbar h1 { font-size: 20px; color: #0f1f3d; margin: 0; }
  .section {
    background: #fff; border-radius: 12px; padding: 22px 24px;
    margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .section h2 { margin: 0 0 14px; font-size: 17px; color: #0f1f3d; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eee; font-size: 14px; }
  .empty { color: #888; font-style: italic; }
  .add-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .add-form input { width: auto; flex: 1; min-width: 140px; margin-top: 0; }
`;

function loginHtml(showError, missingConfig) {
  if (missingConfig) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Configuración pendiente · CREAS</title>
<style>${BASE_STYLE}</style></head>
<body><div class="center"><div class="card">
<h1>Ecosistema CREAS</h1>
<h2>Administración de portales</h2>
<p style="font-size:14px;color:#444;text-align:center;">
Falta configurar la variable <code>ADMIN_PASSWORD</code> en Netlify
(Site configuration → Environment variables) antes de poder usar esta página.
</p>
</div></div></body></html>`;
  }
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Administración de portales · CREAS</title>
<style>${BASE_STYLE}</style>
</head>
<body>
  <div class="center">
    <form class="card" method="POST">
      <h1>Ecosistema CREAS</h1>
      <h2>Administración de portales</h2>
      <input type="hidden" name="action" value="login">
      <label>Contraseña maestra</label>
      <input type="password" name="password" autocomplete="current-password" required autofocus>
      ${showError ? '<div class="error">Contraseña incorrecta.</div>' : ""}
      <button type="submit" style="width:100%;margin-top:20px;">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

function dashboardHtml(usersByPortal, message) {
  const sections = PORTALS.map(({ key, label }) => {
    const users = usersByPortal[key] || [];
    const rows = users.length
      ? users.map((u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td style="text-align:right">
            <form method="POST" style="margin:0;display:inline">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="portal" value="${key}">
              <input type="hidden" name="username" value="${escapeHtml(u.username)}">
              <button type="submit" class="danger">Eliminar</button>
            </form>
          </td>
        </tr>`).join("")
      : `<tr><td colspan="2" class="empty">Todavía no hay usuarios en este portal</td></tr>`;

    return `
      <div class="section">
        <h2>Portal ${label}</h2>
        <table>
          <thead><tr><th>Usuario</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <form method="POST" class="add-form">
          <input type="hidden" name="action" value="add">
          <input type="hidden" name="portal" value="${key}">
          <input type="text" name="username" placeholder="Nuevo usuario" required>
          <input type="password" name="password" placeholder="Contraseña" required>
          <button type="submit">Agregar</button>
        </form>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Administración de portales · CREAS</title>
<style>${BASE_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <h1>Administración de portales — Ecosistema CREAS</h1>
      <form method="POST"><input type="hidden" name="action" value="logout"><button type="submit" class="link">Cerrar sesión</button></form>
    </div>
    ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ""}
    ${sections}
  </div>
</body>
</html>`;
}

export default async (request, context) => {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "";
  if (!adminPassword) {
    return new Response(loginHtml(false, true), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const adminToken = await sha256Hex(`ADMIN|${adminPassword}`);
  const cookieName = "admin_auth";
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const isLoggedIn = cookies[cookieName] === adminToken;

  const store = getStore("portal-credentials");

  async function loadAll() {
    const result = {};
    for (const { key } of PORTALS) {
      result[key] = (await store.get(key, { type: "json" })) || [];
    }
    return result;
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const action = (form.get("action") || "").toString();

    if (action === "login") {
      const password = (form.get("password") || "").toString();
      if (password === adminPassword) {
        const headers = new Headers();
        headers.set("Location", "/admin-portales");
        headers.append(
          "Set-Cookie",
          `${cookieName}=${adminToken}; Path=/admin-portales; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
        );
        return new Response(null, { status: 302, headers });
      }
      return new Response(loginHtml(true, false), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!isLoggedIn) {
      return new Response(loginHtml(false, false), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (action === "logout") {
      const headers = new Headers();
      headers.set("Location", "/admin-portales");
      headers.append(
        "Set-Cookie",
        `${cookieName}=; Path=/admin-portales; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      );
      return new Response(null, { status: 302, headers });
    }

    const portal = (form.get("portal") || "").toString();
    const validPortal = PORTALS.some((p) => p.key === portal);

    if (validPortal && action === "add") {
      const username = (form.get("username") || "").toString().trim();
      const password = (form.get("password") || "").toString();
      if (username && password) {
        const users = (await store.get(portal, { type: "json" })) || [];
        const salt = randomSaltHex();
        const hash = await sha256Hex(`${salt}:${password}`);
        const filtered = users.filter((u) => u.username !== username);
        filtered.push({ username, salt, hash });
        await store.setJSON(portal, filtered);
      }
    }

    if (validPortal && action === "delete") {
      const username = (form.get("username") || "").toString();
      const users = (await store.get(portal, { type: "json" })) || [];
      const filtered = users.filter((u) => u.username !== username);
      await store.setJSON(portal, filtered);
    }

    const headers = new Headers();
    headers.set("Location", "/admin-portales");
    return new Response(null, { status: 302, headers });
  }

  // GET
  if (!isLoggedIn) {
    return new Response(loginHtml(false, false), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const usersByPortal = await loadAll();
  return new Response(dashboardHtml(usersByPortal), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const config = {
  path: ["/admin-portales", "/admin-portales/*"],
};

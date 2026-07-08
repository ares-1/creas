// netlify/edge-functions/portal-auth.js
//
// Protege con usuario/contraseña:
//   - /creas_alumnos/   (Portal Alumnos)
//   - /creas_familias/  (Portal Familias)
//   - /creas_docentes/  (Portal Docentes)
//
// A diferencia de la versión anterior, aquí los usuarios y contraseñas NO
// viven en variables de entorno de Netlify (que obligaban a hacer un
// redeploy cada vez que cambiabas algo). Ahora se guardan en Netlify Blobs
// y se administran desde una páginita propia: /admin-portales
// (ver netlify/edge-functions/admin-portales.js). Los cambios ahí son
// inmediatos, sin necesidad de volver a desplegar el sitio.

import { getStore } from "@netlify/blobs";

const PORTAL_SLUGS = {
  ALUMNOS: "creas_alumnos",
  FAMILIAS: "creas_familias",
  DOCENTES: "creas_docentes",
};

const PORTAL_LABELS = {
  ALUMNOS: "Alumnos",
  FAMILIAS: "Familias",
  DOCENTES: "Docentes",
};

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

function loginPageHtml(label, showError) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Acceso Portal ${label} · CREAS</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0f1f3d 0%, #1b2f57 100%);
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .card {
    background: #ffffff;
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
    font-size: 22px;
    color: #0f1f3d;
    margin: 0 0 24px;
    text-align: center;
  }
  label {
    display: block;
    font-size: 13px;
    color: #444;
    margin-bottom: 6px;
    margin-top: 16px;
  }
  input {
    width: 100%;
    padding: 11px 12px;
    border: 1px solid #d5d5d5;
    border-radius: 8px;
    font-size: 15px;
  }
  input:focus {
    outline: none;
    border-color: #c9a227;
  }
  button {
    width: 100%;
    margin-top: 24px;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: #0f1f3d;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #16305e; }
  .error {
    background: #fdecea;
    color: #b3261e;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 13px;
    margin-top: 16px;
    text-align: center;
  }
</style>
</head>
<body>
  <form class="card" method="POST">
    <h1>Ecosistema CREAS</h1>
    <h2>Portal ${label}</h2>
    <label for="username">Usuario</label>
    <input type="text" id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Contraseña</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    ${showError ? '<div class="error">Usuario o contraseña incorrectos.</div>' : ""}
    <button type="submit">Ingresar</button>
  </form>
</body>
</html>`;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname;

  let portalKey = null;
  if (path === "/creas_alumnos" || path.startsWith("/creas_alumnos/")) portalKey = "ALUMNOS";
  else if (path === "/creas_familias" || path.startsWith("/creas_familias/")) portalKey = "FAMILIAS";
  else if (path === "/creas_docentes" || path.startsWith("/creas_docentes/")) portalKey = "DOCENTES";

  if (!portalKey) {
    return context.next();
  }

  const slug = PORTAL_SLUGS[portalKey];
  const label = PORTAL_LABELS[portalKey];
  const store = getStore("portal-credentials");
  const users = (await store.get(portalKey, { type: "json" })) || [];

  const cookieName = `portal_auth_${portalKey}`;
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const sessionToken = cookies[cookieName];

  async function tokenForUser(u) {
    return sha256Hex(`${portalKey}|${u.username}|${u.hash}`);
  }

  // ¿Ya tiene una cookie de sesión que coincide con algún usuario válido?
  if (sessionToken) {
    for (const u of users) {
      if ((await tokenForUser(u)) === sessionToken) {
        return context.next();
      }
    }
  }

  // ¿Envió el formulario de login?
  if (request.method === "POST") {
    const form = await request.formData();
    const username = (form.get("username") || "").toString().trim();
    const password = (form.get("password") || "").toString();

    const match = users.find((u) => u.username === username);
    if (match) {
      const computedHash = await sha256Hex(`${match.salt}:${password}`);
      if (computedHash === match.hash) {
        const token = await tokenForUser(match);
        const headers = new Headers();
        headers.set("Location", path);
        headers.append(
          "Set-Cookie",
          `${cookieName}=${token}; Path=/${slug}; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
        );
        return new Response(null, { status: 302, headers });
      }
    }

    return new Response(loginPageHtml(label, true), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Primera visita sin sesión: mostrar el formulario
  return new Response(loginPageHtml(label, false), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const config = {
  path: [
    "/creas_alumnos", "/creas_alumnos/*",
    "/creas_familias", "/creas_familias/*",
    "/creas_docentes", "/creas_docentes/*",
  ],
};

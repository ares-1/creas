// netlify/edge-functions/portal-auth.js
//
// Pide usuario y contraseña (HTTP Basic Auth) antes de servir el contenido de:
//   - /creas_alumnos/   (Portal Alumnos)
//   - /creas_familias/  (Portal Familias)
//   - /creas_docentes/  (Portal Docentes)
// en creas.ciemx.com. Cada portal tiene su propio usuario/clave, guardados
// como variables de entorno en Netlify (NO se escriben aquí para no
// exponerlos en el repo).

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // Detecta a qué portal pertenece la ruta solicitada
  let portalKey = null;
  if (path === "/creas_alumnos" || path.startsWith("/creas_alumnos/")) portalKey = "ALUMNOS";
  else if (path === "/creas_familias" || path.startsWith("/creas_familias/")) portalKey = "FAMILIAS";
  else if (path === "/creas_docentes" || path.startsWith("/creas_docentes/")) portalKey = "DOCENTES";

  // Si la ruta no es de ningún portal protegido, sigue de largo
  if (!portalKey) {
    return context.next();
  }

  const expectedUser = Deno.env.get(`PORTAL_${portalKey}_USER`);
  const expectedPass = Deno.env.get(`PORTAL_${portalKey}_PASSWORD`);

  const authHeader = request.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Basic ")) {
    const encoded = authHeader.split(" ")[1];
    try {
      const decoded = atob(encoded);
      const separatorIndex = decoded.indexOf(":");
      const user = decoded.slice(0, separatorIndex);
      const pass = decoded.slice(separatorIndex + 1);

      if (user === expectedUser && pass === expectedPass) {
        return context.next();
      }
    } catch (_err) {
      // credenciales mal formadas, cae al 401 de abajo
    }
  }

  return new Response("Acceso restringido. Ingresa tus credenciales para continuar.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="Portal ${portalKey} - creas.ciemx.com"`,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};

export const config = {
  path: [
    "/creas_alumnos", "/creas_alumnos/*",
    "/creas_familias", "/creas_familias/*",
    "/creas_docentes", "/creas_docentes/*",
  ],
};

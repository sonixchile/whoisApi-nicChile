async function fetchWhoisData(domain: string) {
  const url = `https://www.nic.cl/registry/Whois.do?d=${domain}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" } });
  if (!res.ok) {
    throw new Error(`Error al obtener datos de WHOIS: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  if (!doc) throw new Error("No se pudo parsear el HTML");

  const tdsForNotExistCheck = Array.from(doc.querySelectorAll("td"));
  const dominioNoExiste = tdsForNotExistCheck.find(td =>
    td.textContent.includes("Nombre de dominio no existe") ||
    td.textContent.includes("no está registrado")
  );

  if (dominioNoExiste) {
    return {
      nombreDominio: domain,
      estado: "no_registrado",
      mensaje: "Este dominio no está registrado",
      disponible: true,
      fechaConsulta: new Date().toISOString(),
    };
  }

  // deno-lint-ignore no-explicit-any
  const domainData: any = {
    nombreDominio: domain,
    titular: "",
    agenteRegistrador: "",
    fechaCreacion: "",
    fechaModificacion: "",
    fechaExpiracion: "",
    nameServers: [],
    fechaConsulta: new Date().toISOString(),
    estado: "activo",
    disponible: false,
    enControversia: false,
    linkControversia: null,
    mensajeAdvertencia: null,
    restauracion: null,
  };

  // Verificar si el dominio está en controversia
  const allTds = Array.from(doc.querySelectorAll("td"));
  for (const td of allTds) {
    if (td.textContent.includes("Dominio en controversia:")) {
      domainData.enControversia = true;
      domainData.estado = "en_controversia";
      const linkElement = td.querySelector("a");
      if (linkElement) {
        domainData.linkControversia = linkElement.getAttribute("href");
      }
      break;
    }
  }

  const noticeDivs = Array.from(doc.querySelectorAll("div[style*='background-color: rgb(255, 240, 218)']"));

  for (const noticeDiv of noticeDivs) {
    const noticeText = noticeDiv.textContent.replace(/\s+/g, ' ').trim();

    if (noticeText.includes("Este dominio está en proceso de eliminación.")) {
      domainData.estado = "en_proceso_eliminacion";
      domainData.disponible = false;
      domainData.mensajeAdvertencia = noticeText;
      break;
    } else if (noticeText.includes("Este dominio tiene suspendido su funcionamiento técnico.")) {
      domainData.estado = "suspendido_tecnicamente";
      domainData.disponible = false;
      domainData.mensajeAdvertencia = noticeText;
      break;
    } else if (noticeText.includes("Este dominio se puede restaurar hasta el")) {
      const restorationMatch = noticeText.match(/(\d{4}-\d{2}-\d{2})/);
      domainData.restauracion = {
        fechaLimite: restorationMatch ? restorationMatch[0] : undefined,
        mensaje: noticeText,
      };

      if (domainData.estado === "activo" || domainData.estado === "en_controversia") {
        domainData.estado = "pendiente_restauracion";
      }
      break;
    }
  }

  const rows = Array.from(doc.querySelectorAll("tbody tr"));
  rows.forEach(row => {
    if (!row || !row.querySelector) return;

    const labelDiv = row.querySelector("div[style*='width: 250px;']");
    const valueDiv = row.querySelector("div[style*='width: 280px'], div[style*='text-align: center']");

    if (labelDiv && valueDiv) {
      const label = labelDiv.textContent.replace(":", "").trim();
      let value = valueDiv.textContent.trim();

      if (label === "Agente Registrador") {
        const agentLink = valueDiv.querySelector("a");
        if (agentLink) {
          value = agentLink.textContent.trim();
        }
      }

      switch(label) {
        case "Titular":
          domainData.titular = value;
          break;
        case "Agente Registrador":
          domainData.agenteRegistrador = value;
          break;
        case "Fecha de creación":
          domainData.fechaCreacion = value;
          break;
        case "Fecha de última modificación":
          domainData.fechaModificacion = value;
          break;
        case "Fecha de expiración":
          domainData.fechaExpiracion = value;
          break;
        case "Servidor de Nombre":
          if (value) {
            domainData.nameServers.push(value);
          }
          break;
      }
    }
  });

  domainData.nameServers = domainData.nameServers.filter((ns: string) => ns && ns.trim() !== "");
  if (domainData.estado === "no_registrado") {
      domainData.disponible = true;
  } else {
      domainData.disponible = false;
  }


  return domainData;
}

import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

const router = new Router();

router.get("/whois/:domain", async (ctx) => {
  const { domain } = ctx.params;

  if (!domain || !domain.includes(".cl")) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Debe proporcionar un dominio .cl válido" };
    return;
  }

  try {
    const whoisData = await fetchWhoisData(domain);
    ctx.response.body = whoisData;
  } catch (error: unknown) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Error al consultar WHOIS",
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

const PORT = 8000;
console.log(`Server running on http://localhost:${PORT}`);
await app.listen({ port: PORT });
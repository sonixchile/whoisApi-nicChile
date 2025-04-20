import { Application, Router } from "oak";
import { DOMParser } from "dom";

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

async function fetchWhoisData(domain: string) {
  const url = `https://www.nic.cl/registry/Whois.do?d=${domain}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  
  if (!doc) throw new Error("No se pudo parsear el HTML");

  const tds = Array.from(doc.querySelectorAll("td"));
  const dominioNoExiste = tds.find(td => 
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
    fechaConsulta: "",
    estado: "activo",
    disponible: false
  };

  const rows = Array.from(doc.querySelectorAll("tbody tr"));
  const restorationNotice = doc.querySelector("div[style*='background-color: rgb(255, 240, 218)']");
  if (restorationNotice) {
    domainData.estado = "pendiente_restauracion";
    
    const restorationText = restorationNotice.textContent;
    const restorationMatch = restorationText.match(/(\d{4}-\d{2}-\d{2})/);
    if (restorationMatch) {
      domainData.restauracion = {
        fechaLimite: restorationMatch[0],
        mensaje: restorationText.replace(/\s+/g, ' ').trim(),
      };
    }
  }

  rows.forEach(row => {
    if (!row || !row.querySelector) return;

    const labelDiv = row.querySelector("div[style*='width: 250px;']");
    const valueDiv = row.querySelector("div[style*='width: 280px'], div[style*='text-align: center']");

    if (labelDiv && valueDiv) {
      const label = labelDiv.textContent.replace(":", "").trim();
      const value = valueDiv.textContent.trim();

      switch(label) {
        case "Titular":
          domainData.titular = value;
          break;
        case "Agente Registrador":
          domainData.agenteRegistrador = row.querySelector("a")?.textContent.trim() || value;
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
          domainData.nameServers.push(value);
          break;
      }
    }

    const fechaText = row.querySelector("i");
    if (fechaText) {
      domainData.fechaConsulta = new Date().toISOString();
    }
  });

  return domainData;
}

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

const PORT = 8000;
console.log(`Server running on http://localhost:${PORT}`);
await app.listen({ port: PORT });
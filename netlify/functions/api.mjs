// La Pizarra · servidor de usuarios (Netlify Functions + Netlify Blobs)
import { getStore } from "@netlify/blobs";

const WORDS = ["gol","cano","taco","rabona","chilena","pared","tribuna","potrero","gambeta","palomita","globito","crack","pibe","botin","arco","corner","volea","penal","tiki","bombazo","zurdazo","enganche","sombrero","lujo","barrilete","garra","picado","cabezazo","golazo","tunel","marca","libero","puntero","cinco","diez","hincha","bandera","bombo","clasico","vuelta"];
const CLUBES = ["Boca","River","Racing","Independiente","San Lorenzo","Rosario Central","Newell's","Estudiantes","Gimnasia","Vélez","Huracán","Lanús","Talleres","Belgrano","Banfield","Argentinos","Colón","Unión","Otro"];

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const keyOf = n => "u/" + n.toLowerCase();
const validName = n => /^[A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü_.\-]{3,16}$/.test(n);
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const newKey = () => `${WORDS[rnd(WORDS.length)]}-${WORDS[rnd(WORDS.length)]}-${10 + rnd(90)}`;
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const today = () => new Date().toISOString().slice(0, 10);

// Deja solo campos conocidos y números razonables.
export function cleanP(P, nombre, prev) {
  P = P && typeof P === "object" ? P : {};
  const num = v => Math.max(0, Math.min(1e7, Math.floor(Number(v) || 0)));
  const o = {
    apodo: nombre,
    club: CLUBES.includes(P.club) ? P.club : (prev && prev.club) || "Otro",
    creado: (prev && prev.creado) || (/^\d{4}-\d{2}-\d{2}$/.test(P.creado) ? P.creado : today()),
    pts: num(P.pts), jug: {}, best: {}, dias: {}, visto: { inf: [], jg: [] }
  };
  for (const k of ["inf", "jg", "ln"]) o.jug[k] = num(P.jug && P.jug[k]);
  for (const k of ["inf", "jg", "ln", "racha"]) o.best[k] = num(P.best && P.best[k]);
  if (prev && o.pts > prev.pts + 3000) o.pts = prev.pts + 3000; // freno simple a trampas
  Object.keys(P.dias || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-60).forEach(k => {
    const d = P.dias[k] || {}, r = {};
    for (const g of ["inf", "jg", "ln"]) if (d[g] != null) r[g] = num(d[g]);
    o.dias[k] = r;
  });
  for (const g of ["inf", "jg"]) o.visto[g] = (Array.isArray(P.visto && P.visto[g]) ? P.visto[g] : []).filter(x => typeof x === "string" && x.length < 12).slice(-500);
  return o;
}

export async function handle(req, store) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/api\//, "").replace(/\/$/, "");
  try {
    if (req.method === "GET" && route === "ranking") {
      const { blobs } = await store.list({ prefix: "u/" });
      const users = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
      const ranking = users.filter(Boolean)
        .map(u => ({ nombre: u.nombre, club: (u.P && u.P.club) || "", pts: (u.P && u.P.pts) || 0 }))
        .sort((a, b) => b.pts - a.pts).slice(0, 30);
      return json({ ranking, total: users.length });
    }
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Datos inválidos" }, 400);
    const nombre = String(body.nombre || "").trim();

    if (route === "registro") {
      if (!validName(nombre)) return json({ error: "El nombre tiene que tener entre 3 y 16 letras o números, sin espacios." }, 400);
      if (await store.get(keyOf(nombre))) return json({ error: "Ese nombre ya está en uso. Probá con otro." }, 409);
      const clave = newKey(), salt = newKey() + ":" + Date.now();
      const P = cleanP({ club: body.club, creado: body.creado }, nombre, null);
      await store.setJSON(keyOf(nombre), { nombre, salt, hash: await sha(salt + clave), P, creado: Date.now() });
      return json({ nombre, clave, P });
    }

    if (route === "login" || route === "guardar") {
      const u = await store.get(keyOf(nombre), { type: "json" });
      const clave = String(body.clave || "").trim().toLowerCase();
      if (!u || u.hash !== await sha(u.salt + clave)) return json({ error: "Usuario o palabra clave incorrectos." }, 401);
      if (route === "login") return json({ nombre: u.nombre, P: u.P });
      if (JSON.stringify(body.P || {}).length > 60000) return json({ error: "Datos demasiado grandes" }, 413);
      u.P = cleanP(body.P, u.nombre, u.P);
      await store.setJSON(keyOf(nombre), u);
      return json({ ok: true, pts: u.P.pts });
    }
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    return json({ error: "Error del servidor. Probá de nuevo en un rato." }, 500);
  }
}

export default async req => handle(req, getStore({ name: "pizarra", consistency: "strong" }));
export const config = { path: "/api/*" };

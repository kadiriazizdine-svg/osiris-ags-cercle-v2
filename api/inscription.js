// Inscription au Cercle Privé (V2)
// 1. Vérifie les champs  2. Crée/Met à jour le contact dans Systeme.io + ajoute le tag (qui déclenche l'email)
// 3. Envoie le Lead à Meta (API Conversions)  4. Renvoie le lien WhatsApp
// Variables d'environnement Vercel : SYSTEME_API_KEY, META_CAPI_TOKEN, WHATSAPP_URL, SYSTEME_TAG (optionnel), META_TEST_EVENT_CODE (optionnel)
const crypto = require("crypto");

const PIXEL_ID = "1627718115570252";
const GRAPH = "https://graph.facebook.com/v21.0/";
const SIO = "https://api.systeme.io/api";
const WA_DEFAULT = "https://chat.whatsapp.com/GIlraXAMzR7EfP4VUdprGf";
let tagIdCache = null;

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

async function call(method, path, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  const headers = { "X-API-Key": process.env.SYSTEME_API_KEY, Accept: "application/json" };
  const opt = { method, headers, signal: ctrl.signal };
  if (body) {
    headers["Content-Type"] = method === "PATCH" ? "application/merge-patch+json" : "application/json";
    opt.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(SIO + path, opt);
    let data = null;
    if (r.status !== 204) { try { data = await r.json(); } catch (e) { data = null; } }
    return { status: r.status, ok: r.ok, data };
  } finally { clearTimeout(t); }
}

async function getTagId() {
  if (tagIdCache) return tagIdCache;
  const name = process.env.SYSTEME_TAG || "cercle-v2";
  const list = await call("GET", "/tags?limit=100&query=" + encodeURIComponent(name));
  const items = (list.data && (list.data.items || list.data["hydra:member"])) || [];
  const found = items.find((t) => String(t.name).toLowerCase() === name.toLowerCase());
  if (found) return (tagIdCache = found.id);
  const created = await call("POST", "/tags", { name });
  if (created.ok && created.data && created.data.id) return (tagIdCache = created.data.id);
  throw new Error("Tag introuvable ou impossible à créer (" + created.status + ")");
}

async function upsertContact(c) {
  const fields = [
    { slug: "first_name", value: c.firstName },
    { slug: "phone_number", value: c.phone }
  ];
  let r = await call("POST", "/contacts", { email: c.email, locale: "fr", fields });
  if (r.ok && r.data && r.data.id) return { id: r.data.id, existed: false };

  // Contact déjà existant : on le retrouve et on met à jour ses infos
  const found = await call("GET", "/contacts?limit=10&email=" + encodeURIComponent(c.email));
  const items = (found.data && (found.data.items || found.data["hydra:member"])) || [];
  const hit = items.find((x) => String(x.email).toLowerCase() === c.email);
  if (hit) {
    await call("PATCH", "/contacts/" + hit.id, { fields }).catch(() => null);
    return { id: hit.id, existed: true };
  }

  // Un champ refusé ? On réessaie avec le strict minimum
  if (r.status === 422 || r.status === 400) {
    r = await call("POST", "/contacts", { email: c.email, locale: "fr", fields: [{ slug: "first_name", value: c.firstName }] });
    if (r.ok && r.data && r.data.id) return { id: r.data.id, existed: false };
  }
  throw new Error("Création du contact impossible (" + r.status + ") " + JSON.stringify(r.data || {}).slice(0, 300));
}

async function tagContact(id, existed) {
  const tagId = await getTagId();
  if (existed) await call("DELETE", "/contacts/" + id + "/tags/" + tagId).catch(() => null); // pour relancer l'email
  const r = await call("POST", "/contacts/" + id + "/tags", { tagId });
  if (!r.ok && r.status !== 422) throw new Error("Ajout du tag impossible (" + r.status + ")");
}

async function sendLead(req, b, c) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { skipped: true };
  const cookies = {};
  String(req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > -1) cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || undefined;
  const user = {
    em: [sha(c.email)],
    ph: [sha(c.phone.replace(/\D/g, ""))],
    fn: [sha(c.firstName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim())],
    client_ip_address: ip,
    client_user_agent: req.headers["user-agent"] || undefined,
    fbp: cookies._fbp || b.fbp || undefined,
    fbc: cookies._fbc || b.fbc || undefined
  };
  if (c.country && c.country !== "XX") user.country = [sha(c.country.toLowerCase())];
  const payload = { data: [{
    event_name: "Lead", event_time: Math.floor(Date.now() / 1000), event_id: String(b.event_id || ""),
    action_source: "website", event_source_url: String(b.url || req.headers.referer || ""),
    user_data: user, custom_data: { content_name: "Cercle Privé V2", content_category: "WhatsApp" }
  }] };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(GRAPH + PIXEL_ID + "/events?access_token=" + encodeURIComponent(token), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal
    });
    return await r.json();
  } catch (e) { return { error: String(e) }; } finally { clearTimeout(t); }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const WA = process.env.WHATSAPP_URL || WA_DEFAULT;

  // Test de connexion : /api/inscription?check=1
  if (req.method === "GET") {
    if (!process.env.SYSTEME_API_KEY) return res.status(200).json({ systeme: "clé manquante (SYSTEME_API_KEY)", meta: !!process.env.META_CAPI_TOKEN });
    try { const r = await call("GET", "/tags?limit=10"); return res.status(200).json({ systeme: r.ok ? "ok" : "erreur " + r.status, detail: r.ok ? undefined : r.data, meta: !!process.env.META_CAPI_TOKEN }); }
    catch (e) { return res.status(200).json({ systeme: "injoignable", meta: !!process.env.META_CAPI_TOKEN }); }
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  // Anti-robot : champ invisible rempli = on fait semblant que tout va bien
  if (b.website) return res.status(200).json({ ok: true, whatsapp: WA });

  const c = {
    firstName: String(b.firstName || "").trim().replace(/\s+/g, " ").slice(0, 60),
    email: String(b.email || "").trim().toLowerCase().slice(0, 120),
    phone: String(b.phone || "").replace(/[^\d+]/g, "").slice(0, 16),
    country: String(b.country || "").toUpperCase().slice(0, 2)
  };
  if (c.firstName.length < 2) return res.status(400).json({ ok: false, field: "firstName", message: "Indique ton prénom." });
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email)) return res.status(400).json({ ok: false, field: "email", message: "Ton adresse email n'est pas valide." });
  const d = c.phone.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return res.status(400).json({ ok: false, field: "phone", message: "Ton numéro WhatsApp semble incomplet." });
  if (b.consent !== true) return res.status(400).json({ ok: false, field: "consent", message: "Coche la case pour recevoir le lien." });

  // Sauvegarde de secours dans les journaux Vercel (Deployments > Logs)
  console.log("INSCRIPTION", JSON.stringify({ t: new Date().toISOString(), ...c }));

  try {
    if (!process.env.SYSTEME_API_KEY) throw new Error("SYSTEME_API_KEY manquante");
    const contact = await upsertContact(c);
    await tagContact(contact.id, contact.existed);
  } catch (e) {
    console.error("SYSTEME_ERREUR", String(e));
    return res.status(502).json({ ok: false, message: "Enregistrement impossible pour le moment." });
  }

  const meta = await sendLead(req, b, c);
  if (meta && (meta.error || meta.skipped)) console.error("META", JSON.stringify(meta));
  return res.status(200).json({ ok: true, whatsapp: WA });
};

// Lien fixe à mettre dans l'email : https://osiris-ags-cercle-v2.vercel.app/rejoindre
// Il redirige vers le groupe WhatsApp défini dans la variable WHATSAPP_URL.
module.exports = function handler(req, res) {
  const WA = process.env.WHATSAPP_URL || "https://chat.whatsapp.com/GIlraXAMzR7EfP4VUdprGf";
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 302;
  res.setHeader("Location", WA);
  res.end();
};

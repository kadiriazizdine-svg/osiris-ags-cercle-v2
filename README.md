# Osiris AGS · Le Cercle Privé — V2 (formulaire)

Même page que la V1, mais chaque bouton ouvre un formulaire (prénom, email, WhatsApp).
Après un envoi valide : contact créé dans Systeme.io + tag « cercle-v2 » → Lead Meta (Pixel + API Conversions) → redirection vers WhatsApp.

## Fichiers
- `index.html` : la page
- `assets/img/` : images
- `api/inscription.js` : enregistre le contact dans Systeme.io et envoie le Lead à Meta
- `api/rejoindre.js` + `vercel.json` : l'adresse /rejoindre redirige vers le groupe WhatsApp (à utiliser dans l'email)

## Variables d'environnement (Vercel > Settings > Environment Variables)
| Nom | Valeur |
|---|---|
| SYSTEME_API_KEY | Clé API publique Systeme.io |
| META_CAPI_TOKEN | Token de l'API Conversions Meta |
| WHATSAPP_URL | Lien du groupe WhatsApp |
| SYSTEME_TAG | (optionnel) nom du tag, par défaut `cercle-v2` |
| META_TEST_EVENT_CODE | (optionnel, tests uniquement) |

Après tout ajout ou changement de variable : Deployments > « … » > Redeploy.

## Vérifier la connexion Systeme.io
Ouvre https://TON-DOMAINE/api/inscription?check=1 → doit afficher `"systeme":"ok"` et `"meta":true`.

## Changer le lien WhatsApp
Modifie la variable WHATSAPP_URL dans Vercel, puis Redeploy.

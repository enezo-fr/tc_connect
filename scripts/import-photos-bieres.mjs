// Rattache les photos exportées d'AppSheet aux dégustations importées.
//
//   node scripts/import-photos-bieres.mjs --email=teddy.blouet@gmail.com          (simulation)
//   node scripts/import-photos-bieres.mjs --email=teddy.blouet@gmail.com --apply  (envoi)
//
// Déposer les images dans docs/photos-bieres/ EN GARDANT LEURS NOMS AppSheet
// (« 0e64e014.Photo de la bière.173445.jpg ») : ce sont ces noms exacts qui
// figurent dans DatabaseBeer.csv, colonnes « Photo de la bière » et « Photo du
// moment ». C'est ce qui permet de relier chaque image à sa bière sans tri.
//
// Les fichiers partent dans Storage sous users/{uid}/bieres/, chemin déjà
// autorisé par les règles, puis l'URL est ajoutée au tableau `photos` de la
// dégustation correspondante.

import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const email = (args.find((a) => a.startsWith('--email=')) ?? '').split('=')[1] ?? 'teddy.blouet@gmail.com'
const DOSSIER = path.join('docs', 'photos-bieres')

if (!fs.existsSync(DOSSIER)) {
  console.error(`Dossier introuvable : ${DOSSIER}`)
  console.error('Dépose les images dedans, en conservant leurs noms de fichiers AppSheet.')
  process.exit(1)
}

const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)
  if (m) env[m[1]] = m[2]
}
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\r/g, '').replace(/\\n/g, '\n'),
  }),
  storageBucket: `${env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
})
const db = admin.firestore()
const bucket = admin.storage().bucket()

function lireCsv(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8')
  const lignes = []
  let champ = ''; let ligne = []; let guillemets = false
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++ }
      else if (c === '"') guillemets = false
      else champ += c
    } else if (c === '"') guillemets = true
    else if (c === ';') { ligne.push(champ); champ = '' }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = '' }
    else if (c !== '\r') champ += c
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne) }
  return lignes
}

const uid = (await admin.auth().getUserByEmail(email)).uid
console.log(`Compte : ${uid}`)

// ── Table de correspondance : nom de fichier → identifiant AppSheet de la bière
const lignes = lireCsv(path.join('docs', 'export-app-sarah-teddy', 'DatabaseBeer.csv'))
const e = lignes[0]
const iId = e.indexOf('IDDataBaseBeer')
const iNom = e.indexOf('Nom')
const colonnesPhoto = ['Photo de la bière', 'Photo du moment'].map((c) => e.indexOf(c)).filter((i) => i >= 0)

const parFichier = new Map() // nom de fichier (minuscules) → { sourceId, nom }
for (const l of lignes.slice(1)) {
  const sourceId = (l[iId] ?? '').trim()
  if (!sourceId) continue
  for (const c of colonnesPhoto) {
    const chemin = (l[c] ?? '').trim()
    if (!chemin) continue
    // AppSheet stocke « Databeer_Images/xxx.jpg » : seul le nom de fichier compte
    const fichier = chemin.split('/').pop().toLowerCase()
    parFichier.set(fichier, { sourceId, nom: (l[iNom] ?? '').trim() })
  }
}
console.log(`${parFichier.size} photo(s) référencées dans le CSV`)

// ── Bières en base, indexées par sourceId
const snap = await db.collection('bieres').where('members', 'array-contains', uid).get()
const parSource = new Map()
snap.forEach((d) => { const s = d.data().sourceId; if (s) parSource.set(s, d) })
console.log(`${parSource.size} bière(s) en base avec un identifiant d'origine\n`)

const fichiers = fs.readdirSync(DOSSIER).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
console.log(`${fichiers.length} image(s) dans ${DOSSIER}`)

let envoyees = 0
let orphelines = []

for (const f of fichiers) {
  const ref = parFichier.get(f.toLowerCase())
  if (!ref) { orphelines.push(f); continue }
  const docBiere = parSource.get(ref.sourceId)
  if (!docBiere) { orphelines.push(f); continue }

  if (APPLY) {
    const dest = `users/${uid}/bieres/import/${f}`
    await bucket.upload(path.join(DOSSIER, f), { destination: dest })
    const fichierStockage = bucket.file(dest)
    // URL publique stable : on rend le fichier lisible, comme les autres images de l'app
    await fichierStockage.makePublic()
    const url = `https://storage.googleapis.com/${bucket.name}/${encodeURI(dest)}`

    // Une seule dégustation par bière après l'import : on l'y rattache
    const degs = await docBiere.ref.collection('degustations').limit(1).get()
    if (!degs.empty) {
      const d = degs.docs[0]
      const dejaLa = d.data().photos ?? []
      if (!dejaLa.includes(url)) {
        await d.ref.update({ photos: [...dejaLa, url] })
      }
    }
  }
  envoyees++
  if (envoyees <= 3) console.log(`  ex. ${f} → ${ref.nom}`)
}

console.log(`\n${envoyees} photo(s) ${APPLY ? 'envoyées et rattachées' : 'à envoyer'}`)
if (orphelines.length) {
  console.log(`${orphelines.length} sans correspondance (nom de fichier absent du CSV) :`)
  console.log('  ' + orphelines.slice(0, 8).join('\n  '))
}
if (!APPLY) console.log('\nSIMULATION — relance avec --apply pour envoyer.')
process.exit(0)

// Import du catalogue de bières depuis l'export de l'ancienne app AppSheet.
//
//   node scripts/import-bieres.mjs --email=teddy.blouet@gmail.com          (simulation)
//   node scripts/import-bieres.mjs --email=teddy.blouet@gmail.com --apply  (écriture)
//
// Source : docs/export-app-sarah-teddy/DatabaseBeer.csv (extrait du classeur
// « App Sarah et Teddy.xlsx »). Une ligne = une bière + sa première dégustation.
//
// ⚠️ PROD : simulation par défaut, et on refuse d'importer deux fois la même
// bière (repérée par son identifiant AppSheet, conservé dans `sourceId`).

import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const email = (args.find((a) => a.startsWith('--email=')) ?? '').split('=')[1]
const uidArg = (args.find((a) => a.startsWith('--uid=')) ?? '').split('=')[1]
if (!email && !uidArg) {
  console.error('Précise --email=… (ou --uid=…) : c\'est le compte propriétaire du catalogue.')
  process.exit(1)
}

// ── Identifiants Admin SDK (.env.local) ──────────────────────────────────────
const env = {}
for (const ligne of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)
  if (m) env[m[1]] = m[2]
}
// La clé contient des « \n » littéraux (2 caractères) : sans conversion,
// OpenSSL rejette le PEM avec « DECODER routines::unsupported ».
const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\r/g, '').replace(/\\n/g, '\n')
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
})
const db = admin.firestore()

// ── Lecture du CSV (séparateur « ; », guillemets doublés) ────────────────────
function lireCsv(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8')
  const lignes = []
  let champ = ''
  let ligne = []
  let dansGuillemets = false
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (dansGuillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++ }
      else if (c === '"') dansGuillemets = false
      else champ += c
    } else if (c === '"') dansGuillemets = true
    else if (c === ';') { ligne.push(champ); champ = '' }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = '' }
    else if (c !== '\r') champ += c
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne) }
  return lignes
}

/** Numéro de série tableur → Date (origine 30/12/1899, comme Excel et Sheets) */
function dateDeSerie(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000))
}

const nombre = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}
const texte = (v) => {
  const s = String(v ?? '').trim()
  return s || undefined
}

// ── Import ───────────────────────────────────────────────────────────────────
const fichier = path.join('docs', 'export-app-sarah-teddy', 'DatabaseBeer.csv')
const lignes = lireCsv(fichier)
const entete = lignes[0]
const col = (nom) => entete.indexOf(nom)

const iId = col('IDDataBaseBeer')
const iDate = col('Date')
const iService = col('Service')
const iType = col('Type de bière')
const iTypologie = col('Typologie')
const iNom = col('Nom')
const iDegres = col('Degrés')
const iSarah = col('Note Sarah')
const iTeddy = col('Note Teddy')
const iAnalyse = col('Analyse')
const iGps = col('Coordonnées GPS')
const iPays = col('Pays (ou Région)')
const iLieu = col('Bar / Ville')
const iContexte = col('Contexte (terrasse, intérieur, ...)')
const iEvenement = col('Evenement')
const iMeteo = col('Météo')
const iRessenti = col('Froid, très chaud ou bien')
const iTemp = col('Température')
const iIbu = col('IBU/DI (proche de 1 = Amer)')

const uid = uidArg ?? (await admin.auth().getUserByEmail(email)).uid
console.log(`Compte propriétaire : ${uid}`)

// Les deux notes historiques appartiennent à deux personnes. Faute de connaître
// l'UID de Sarah, la sienne est rangée sous une clé lisible que l'app affichera
// telle quelle ; à remplacer le jour où elle aura un compte.
const UID_SARAH = (args.find((a) => a.startsWith('--uid-sarah=')) ?? '').split('=')[1] ?? 'sarah'

const dejaImportees = new Set()
if (APPLY || true) {
  const snap = await db.collection('bieres').where('members', 'array-contains', uid).get()
  snap.forEach((d) => { const s = d.data().sourceId; if (s) dejaImportees.add(s) })
}

const donnees = lignes.slice(1).filter((l) => texte(l[iNom]))
let creees = 0
let ignorees = 0

for (const l of donnees) {
  const sourceId = texte(l[iId])
  if (sourceId && dejaImportees.has(sourceId)) { ignorees++; continue }

  const biere = {
    members: [uid],
    createdBy: uid,
    sourceId: sourceId ?? null,
    nom: texte(l[iNom]),
    service: texte(l[iService]) ?? '',
    type: texte(l[iType]) ?? '',
    typologie: texte(l[iTypologie]) ?? '',
    degres: nombre(l[iDegres]),
    ibu: nombre(l[iIbu]),
    origine: texte(l[iPays]) ?? '',
    createdAt: admin.firestore.Timestamp.now(),
  }

  const notes = {}
  const nS = nombre(l[iSarah])
  const nT = nombre(l[iTeddy])
  if (nT !== undefined) notes[uid] = nT
  if (nS !== undefined) notes[UID_SARAH] = nS

  const d = dateDeSerie(l[iDate])
  const degustation = {
    createdBy: uid,
    membersDeg: [uid],
    date: d ? admin.firestore.Timestamp.fromDate(d) : null,
    notes: Object.keys(notes).length ? notes : null,
    analyse: texte(l[iAnalyse]) ?? null,
    lieu: texte(l[iLieu]) ?? null,
    gps: texte(l[iGps]) ?? null,
    contexte: texte(l[iContexte]) ?? null,
    evenement: texte(l[iEvenement]) ?? null,
    meteo: texte(l[iMeteo]) ?? null,
    ressenti: texte(l[iRessenti]) ?? null,
    temperature: nombre(l[iTemp]) ?? null,
    createdAt: admin.firestore.Timestamp.now(),
  }

  if (APPLY) {
    const ref = await db.collection('bieres').add(nettoyer(biere))
    await ref.collection('degustations').add(nettoyer(degustation))
  }
  creees++
  if (creees <= 3) {
    console.log(`  ex. ${biere.nom} — ${biere.type ?? '?'} ${biere.degres ?? '?'}° · notes ${JSON.stringify(notes)}`)
  }
}

/** Firestore refuse `undefined` ; `null` signifie « champ absent » côté app */
function nettoyer(o) {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v
  return out
}

console.log(`\n${donnees.length} lignes lues`)
console.log(`${creees} bière(s) ${APPLY ? 'créées' : 'à créer'}${ignorees ? ` · ${ignorees} déjà importée(s), ignorée(s)` : ''}`)
if (!APPLY) console.log('\nSIMULATION — relance avec --apply pour écrire.')
process.exit(0)

// Import des listes « À deux » depuis l'export de l'ancienne app AppSheet.
//
//   node scripts/import-a-deux.mjs --email=teddy.blouet@gmail.com          (simulation)
//   node scripts/import-a-deux.mjs --email=teddy.blouet@gmail.com --apply  (écriture)
//
// Sources : docs/export-app-sarah-teddy/{FilmsSeries,Activites,Jeux}.csv
// Les 18 lignes « Jeux » sont des TOURS : on les regroupe en parties, une partie
// commençant à chaque ligne marquée « Partie ».

import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const email = (args.find((a) => a.startsWith('--email=')) ?? '').split('=')[1]
const uidArg = (args.find((a) => a.startsWith('--uid=')) ?? '').split('=')[1]
if (!email && !uidArg) {
  console.error('Précise --email=… (ou --uid=…).')
  process.exit(1)
}

const env = {}
for (const ligne of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)
  if (m) env[m[1]] = m[2]
}
const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\r/g, '').replace(/\\n/g, '\n')
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
})
const db = admin.firestore()

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

const dossier = path.join('docs', 'export-app-sarah-teddy')
const txt = (v) => { const s = String(v ?? '').trim(); return s || undefined }
const nb = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined }
/** Numéro de série tableur → Date (origine 30/12/1899) */
const dateSerie = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000))
}
/** « ⭐⭐⭐⭐ » → 4 */
const compterEtoiles = (v) => {
  const s = String(v ?? '')
  const n = (s.match(/⭐/g) ?? []).length
  return n > 0 ? n : undefined
}
const nettoyer = (o) => {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v
  return out
}

const uid = uidArg ?? (await admin.auth().getUserByEmail(email)).uid
console.log(`Compte propriétaire : ${uid}\n`)
const base = { members: [uid], createdBy: uid }

let total = 0

// ── Films & séries ───────────────────────────────────────────────────────────
{
  const l = lireCsv(path.join(dossier, 'FilmsSeries.csv'))
  const e = l[0]; const c = (n) => e.indexOf(n)
  const existants = new Set()
  const snap = await db.collection('duo_films').where('members', 'array-contains', uid).get()
  snap.forEach((d) => existants.add((d.data().nom ?? '').toLowerCase()))

  let n = 0
  for (const r of l.slice(1)) {
    const nom = txt(r[c('Nom')])
    if (!nom || existants.has(nom.toLowerCase())) continue
    const d = dateSerie(r[c('Date de sortie')])
    const doc = nettoyer({
      ...base,
      type: txt(r[c('Type')]) ?? 'Film',
      nom,
      plateforme: txt(r[c('Plateforme')]),
      categorie: txt(r[c('Catégorie')]),
      note: compterEtoiles(r[c('Note')]),
      // « Oui » dans l'ancienne base ; l'absence vaut « pas encore vu »
      vu: txt(r[c('Vu ou non vu')]) ? true : false,
      dateSortie: d ? admin.firestore.Timestamp.fromDate(d) : undefined,
      saison: txt(r[c('Saison / Partie')]),
      infos: txt(r[c('Infos complémentaires')]),
      createdAt: admin.firestore.Timestamp.now(),
    })
    if (APPLY) await db.collection('duo_films').add(doc)
    n++
  }
  console.log(`Films & séries : ${n} ${APPLY ? 'créés' : 'à créer'}`)
  total += n
}

// ── Activités ────────────────────────────────────────────────────────────────
{
  const l = lireCsv(path.join(dossier, 'Activites.csv'))
  const e = l[0]; const c = (n) => e.indexOf(n)
  const existants = new Set()
  const snap = await db.collection('duo_activites').where('members', 'array-contains', uid).get()
  snap.forEach((d) => existants.add((d.data().nom ?? '').toLowerCase()))

  let n = 0
  for (const r of l.slice(1)) {
    const nom = txt(r[c('Activité')])
    if (!nom || existants.has(nom.toLowerCase())) continue
    const doc = nettoyer({
      ...base,
      nom,
      type: txt(r[c('Type')]),
      zone: txt(r[c('Zone géographique')]),
      // Deux colonnes GPS dans l'ancienne base (à faire / déjà fait) : même valeur
      gps: txt(r[c('Lieu')]) ?? txt(r[c('Lieux des choses déjà faites')]),
      fait: txt(r[c('Déjà fait')]) ? true : false,
      note: compterEtoiles(r[c('Note')]),
      priorite: txt(r[c('Priorité')]),
      conseillePar: txt(r[c('Conseil venu de')]),
      lien: txt(r[c('Lien')]),
      gammePrix: txt(r[c('Gamme de prix')]),
      infos: txt(r[c('Infos complémentaires')]),
      createdAt: admin.firestore.Timestamp.now(),
    })
    if (APPLY) await db.collection('duo_activites').add(doc)
    n++
  }
  console.log(`Activités : ${n} ${APPLY ? 'créées' : 'à créer'}`)
  total += n
}

// ── Parties de jeux ──────────────────────────────────────────────────────────
{
  const l = lireCsv(path.join(dossier, 'Jeux.csv'))
  const e = l[0]; const c = (n) => e.indexOf(n)
  const dejaVues = new Set()
  const snap = await db.collection('duo_parties').where('members', 'array-contains', uid).get()
  snap.forEach((d) => dejaVues.add(`${d.data().jeu}|${d.data().date?.toMillis?.() ?? ''}`))

  // Une ligne = un TOUR. La colonne « Partie » n'est remplie que sur le premier
  // tour d'une partie : c'est ce marqueur qui découpe la suite.
  const parties = []
  for (const r of l.slice(1)) {
    const jeu = txt(r[c('Jeux')])
    if (!jeu) continue
    const joueurs = []
    const scores = []
    for (let i = 1; i <= 15; i++) {
      const nomJ = txt(r[c(`Joueur ${i}`)])
      if (!nomJ) continue
      joueurs.push(nomJ)
      scores.push({ joueur: nomJ, points: nb(r[c(`Point joueur ${i}`)]) ?? 0 })
    }
    const d = dateSerie(r[c('Date')])
    if (txt(r[c('Partie')]) || parties.length === 0 || parties[parties.length - 1].jeu !== jeu) {
      parties.push({ jeu, date: d, joueurs, tours: [{ scores }] })
    } else {
      const p = parties[parties.length - 1]
      p.tours.push({ scores })
      for (const j of joueurs) if (!p.joueurs.includes(j)) p.joueurs.push(j)
    }
  }

  let n = 0
  for (const p of parties) {
    const cle = `${p.jeu}|${p.date ? p.date.getTime() : ''}`
    if (dejaVues.has(cle)) continue
    const doc = nettoyer({
      ...base,
      jeu: p.jeu,
      date: p.date ? admin.firestore.Timestamp.fromDate(p.date) : undefined,
      joueurs: p.joueurs,
      tours: p.tours,
      termine: true,
      createdAt: admin.firestore.Timestamp.now(),
    })
    if (APPLY) await db.collection('duo_parties').add(doc)
    n++
    if (n <= 5) console.log(`  ex. ${p.jeu} — ${p.joueurs.join(', ')} — ${p.tours.length} tour(s)`)
  }
  console.log(`Parties : ${n} ${APPLY ? 'créées' : 'à créer'}`)
  total += n
}

console.log(`\nTotal : ${total} document(s) ${APPLY ? 'écrits' : 'à écrire'}`)
if (!APPLY) console.log('SIMULATION — relance avec --apply pour écrire.')
process.exit(0)

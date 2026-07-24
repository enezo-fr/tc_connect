// Sépare l'ancien champ « Bar / Ville » des dégustations importées.
//
//   node scripts/separer-lieu-ville.mjs --email=teddy.blouet@gmail.com          (simulation)
//   node scripts/separer-lieu-ville.mjs --email=teddy.blouet@gmail.com --apply  (écriture)
//
// L'app AppSheet entassait l'établissement et la ville dans un seul champ, avec
// un « / » comme séparateur (parfois une virgule). On remplit `ville` et on
// réduit `lieu` à l'établissement seul.
//
// Sans séparateur, on ne devine pas : la valeur reste entière dans `lieu`.
// Rejouable : une dégustation qui a déjà une `ville` n'est pas retouchée.

import fs from 'fs'
import admin from 'firebase-admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const email = (args.find((a) => a.startsWith('--email=')) ?? '').split('=')[1] ?? 'teddy.blouet@gmail.com'

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
})
const db = admin.firestore()

/** Même règle que `separerLieu` dans lib/biereModel.ts */
function separer(v) {
  const s = (v ?? '').trim()
  if (!s) return { lieu: '', ville: '' }
  const m = s.split(/\s*[/,]\s*/)
  if (m.length >= 2) return { lieu: m.slice(0, -1).join(' / ').trim(), ville: m[m.length - 1].trim() }
  return { lieu: s, ville: '' }
}

const uid = (await admin.auth().getUserByEmail(email)).uid
const snap = await db.collection('bieres').where('members', 'array-contains', uid).get()
console.log(`${snap.size} bière(s)\n`)

let separees = 0
let inchangees = 0
const exemples = []

for (const doc of snap.docs) {
  const degs = await doc.ref.collection('degustations').get()
  for (const d of degs.docs) {
    const data = d.data()
    // Déjà traitée, ou rien à traiter
    if (data.ville || !data.lieu) { inchangees++; continue }
    const { lieu, ville } = separer(data.lieu)
    if (!ville) { inchangees++; continue }
    if (exemples.length < 6) exemples.push(`${data.lieu}  →  « ${lieu} » · « ${ville} »`)
    separees++
    if (APPLY) await d.ref.update({ lieu, ville })
  }
}

console.log(exemples.join('\n'))
console.log(`\n${separees} dégustation(s) ${APPLY ? 'séparées' : 'à séparer'}`)
console.log(`${inchangees} laissée(s) telle(s) quelle(s) (pas de séparateur, ou déjà faite)`)
if (!APPLY) console.log('\nSIMULATION — relance avec --apply pour écrire.')
process.exit(0)

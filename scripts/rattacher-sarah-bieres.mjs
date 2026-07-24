// Rattache les notes importées sous la clé « sarah » au VRAI compte de Sarah.
//
//   node scripts/rattacher-sarah-bieres.mjs --email=sarahdmln@outlook.fr          (simulation)
//   node scripts/rattacher-sarah-bieres.mjs --email=sarahdmln@outlook.fr --apply  (écriture)
//
// L'import a rangé ses notes sous une clé provisoire faute de connaître son UID.
// Ce script la remplace partout, ET l'ajoute aux `members` du catalogue pour
// qu'elle y ait accès (règles Firestore : lecture réservée aux membres).

import fs from 'fs'
import admin from 'firebase-admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const email = (args.find((a) => a.startsWith('--email=')) ?? '').split('=')[1]
/** Clé provisoire posée par l'import */
const CLE_PROVISOIRE = (args.find((a) => a.startsWith('--cle=')) ?? '').split('=')[1] ?? 'sarah'
/** Propriétaire du catalogue (celui qui a importé) */
const emailProprio = (args.find((a) => a.startsWith('--proprio=')) ?? '').split('=')[1]
  ?? 'teddy.blouet@gmail.com'

if (!email) {
  console.error('Précise --email=… (le compte de la personne à rattacher).')
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
})
const db = admin.firestore()

let cible
try {
  cible = await admin.auth().getUserByEmail(email)
} catch {
  console.error(`Aucun compte Firebase pour ${email}. Elle doit d'abord créer son compte dans l'app.`)
  process.exit(1)
}
const uidSarah = cible.uid
const uidProprio = (await admin.auth().getUserByEmail(emailProprio)).uid
console.log(`Cible : ${email} → ${uidSarah}`)
console.log(`Catalogue de : ${emailProprio} → ${uidProprio}\n`)

const snap = await db.collection('bieres').where('members', 'array-contains', uidProprio).get()
console.log(`${snap.size} bière(s) dans le catalogue`)

let notesReprises = 0
let bieresPartagees = 0
let degsTouchees = 0

for (const doc of snap.docs) {
  const membres = doc.data().members ?? []
  if (!membres.includes(uidSarah)) {
    bieresPartagees++
    if (APPLY) await doc.ref.update({ members: [...membres, uidSarah] })
  }

  const degs = await doc.ref.collection('degustations').get()
  for (const d of degs.docs) {
    const data = d.data()
    const patch = {}

    // Notes : on déplace la clé provisoire vers l'UID réel, sans écraser une
    // note déjà présente sous cet UID (le cas ne devrait pas arriver, mais une
    // reprise de données ne doit jamais perdre d'information).
    const notes = data.notes ?? {}
    if (notes[CLE_PROVISOIRE] !== undefined && notes[uidSarah] === undefined) {
      const nouvelles = { ...notes, [uidSarah]: notes[CLE_PROVISOIRE] }
      delete nouvelles[CLE_PROVISOIRE]
      patch.notes = nouvelles
      notesReprises++
    }

    // `membersDeg` conditionne la lecture des dégustations (requête de groupe)
    const md = data.membersDeg ?? []
    if (!md.includes(uidSarah)) patch.membersDeg = [...md, uidSarah]

    if (Object.keys(patch).length) {
      degsTouchees++
      if (APPLY) await d.ref.update(patch)
    }
  }
}

console.log(`\n${notesReprises} note(s) « ${CLE_PROVISOIRE} » ${APPLY ? 'rattachées' : 'à rattacher'}`)
console.log(`${bieresPartagees} bière(s) ${APPLY ? 'partagées' : 'à partager'} avec elle`)
console.log(`${degsTouchees} dégustation(s) ${APPLY ? 'mises à jour' : 'à mettre à jour'}`)
if (!APPLY) console.log('\nSIMULATION — relance avec --apply pour écrire.')
process.exit(0)

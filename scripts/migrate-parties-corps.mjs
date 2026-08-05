// scripts/migrate-parties-corps.mjs
// Exercices : `partie_prioritaire` passe des MUSCLES aux 4 ZONES du corps
// (Haut du corps / Bas du corps / Centre du corps / Global).
//
// Pour chaque exercice :
//   1. l'ancienne valeur est convertie en zone (table ci-dessous) ;
//   2. si cette ancienne valeur était un VRAI muscle, elle est ajoutée aux
//      « Muscles ciblés » quand elle n'y figure pas déjà — sinon l'information
//      portée par la partie prioritaire serait perdue.
//      (« Cardio », « Full body » et « Autre » ne sont pas des muscles : rien à recopier.)
//
// Usage :
//   node scripts/migrate-parties-corps.mjs            → DRY-RUN (n'écrit rien, montre le plan)
//   node scripts/migrate-parties-corps.mjs --apply    → applique
//
// ⚠️ Cible la PROD (creds .env.local). Dry-run d'abord, on valide, puis --apply.
// La table doit rester alignée sur lib/exerciceOptions.ts (ANCIENNES_PARTIES / MUSCLES).

import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const APPLY = process.argv.includes('--apply')

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}

function normalizeKey(raw) {
  let key = (raw ?? '').trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1)
  key = key.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '')
  if (!key.endsWith('\n')) key += '\n'
  return key
}

const PARTIES_CORPS = ['Haut du corps', 'Bas du corps', 'Centre du corps', 'Global']

const ANCIENNES_PARTIES = {
  'quadriceps': 'Bas du corps',
  'ischio-jambiers': 'Bas du corps',
  'ischio jambiers': 'Bas du corps',
  'fessiers': 'Bas du corps',
  'mollets': 'Bas du corps',
  'pectoraux': 'Haut du corps',
  'dos': 'Haut du corps',
  'épaules': 'Haut du corps',
  'epaules': 'Haut du corps',
  'biceps': 'Haut du corps',
  'triceps': 'Haut du corps',
  'abdominaux': 'Centre du corps',
  'core': 'Centre du corps',
  'gainage': 'Centre du corps',
  'lombaires': 'Centre du corps',
  'cardio': 'Global',
  'full body': 'Global',
  'tout le corps': 'Global',
  'mouvements combinés': 'Global',
  'mouvements combines': 'Global',
  'autre': 'Global',
}

// Libellés officiels des muscles (pour recopier l'ancienne partie avec la bonne casse).
const MUSCLES = [
  'Quadriceps', 'Ischio-jambiers', 'Fessiers', 'Mollets',
  'Pectoraux', 'Dos', 'Épaules', 'Biceps', 'Triceps',
  'Abdominaux', 'Core',
]

const muscleOfficiel = (valeur) =>
  MUSCLES.find((m) => m.toLowerCase() === String(valeur).trim().toLowerCase()) ?? null

const env = loadEnv()
const projectId = env.FIREBASE_PROJECT_ID
admin.initializeApp({
  credential: admin.credential.cert({
    projectId,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizeKey(env.FIREBASE_PRIVATE_KEY),
  }),
})
const db = admin.firestore()

async function main() {
  console.log(`\n🎯 Projet Firebase ciblé : ${projectId}`)
  console.log(`Mode : ${APPLY ? '✍️  APPLY (écriture)' : '👀 DRY-RUN (lecture seule)'}\n`)

  const snap = await db.collection('exercices').get()
  console.log(`🏋️  ${snap.size} exercices en base\n`)

  const parAncienne = new Map()
  const updates = []
  const inconnues = new Set()

  snap.forEach((d) => {
    const ex = d.data()
    const ancienne = String(ex.partie_prioritaire ?? '').trim()
    parAncienne.set(ancienne || '(vide)', (parAncienne.get(ancienne || '(vide)') ?? 0) + 1)

    if (PARTIES_CORPS.includes(ancienne)) return // déjà converti

    const cle = ancienne.toLowerCase()
    const zone = ANCIENNES_PARTIES[cle]
    if (ancienne && !zone) inconnues.add(ancienne)

    const changes = { partie_prioritaire: zone ?? 'Global' }

    const muscles = Array.isArray(ex.Muscles) ? [...ex.Muscles] : []
    const muscle = muscleOfficiel(ancienne)
    const dejaPresent = muscle && muscles.some((m) => String(m).toLowerCase() === muscle.toLowerCase())
    if (muscle && !dejaPresent) {
      muscles.push(muscle)
      changes.Muscles = muscles
    }

    updates.push({ id: d.id, nom: ex.nom_exercice ?? '(sans nom)', ancienne: ancienne || '(vide)', changes })
  })

  console.log('📊 Valeurs actuelles de partie_prioritaire :')
  ;[...parAncienne.entries()].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => console.log(`     ${String(n).padStart(4)} × ${v}`))
  console.log('')

  if (inconnues.size) {
    console.log(`⚠️  Valeurs sans correspondance (rangées dans « Global ») : ${[...inconnues].join(', ')}\n`)
  }

  console.log(`✏️  ${updates.length} exercices à convertir :`)
  for (const u of updates) {
    const ajout = u.changes.Muscles ? ` ; + muscle « ${u.changes.Muscles[u.changes.Muscles.length - 1]} »` : ''
    console.log(`     [${u.id}] ${u.nom} : « ${u.ancienne} » → « ${u.changes.partie_prioritaire} »${ajout}`)
  }
  console.log('')

  if (!APPLY) {
    console.log('👀 DRY-RUN terminé — rien n\'a été écrit. Relancer avec --apply pour appliquer.\n')
    return
  }

  let batch = db.batch()
  let n = 0
  for (const u of updates) {
    batch.update(db.collection('exercices').doc(u.id), u.changes)
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  if (n % 400 !== 0) await batch.commit()
  console.log(`✅ ${updates.length} exercices mis à jour.\n`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

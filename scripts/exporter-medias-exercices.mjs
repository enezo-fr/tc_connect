// scripts/exporter-medias-exercices.mjs
// SAUVEGARDE : récupère sur le disque toutes les photos et vidéos des exercices.
//
// Rien n'est modifié : c'est de la LECTURE seule (Firestore + téléchargement des
// fichiers Storage). Un média partagé par plusieurs exercices n'est téléchargé
// qu'UNE fois — un `index.csv` dit quel exercice utilise quel fichier.
//
// Usage :
//   node scripts/exporter-medias-exercices.mjs                    → dans ./export-medias-exercices
//   node scripts/exporter-medias-exercices.mjs "D:/sauvegardes"   → dans le dossier indiqué

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import admin from 'firebase-admin'

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

const nomFichier = (nom, ext) => {
  const base = (nom || 'exercice')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'exercice'
  return `${base}.${ext}`
}

const extDepuis = (contentType, url) => {
  const mime = (contentType || '').split('/')[1]?.split(';')[0]
  if (mime === 'quicktime') return 'mov'
  if (mime) return mime
  return url.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/)?.[1] ?? 'bin'
}

const env = loadEnv()
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizeKey(env.FIREBASE_PRIVATE_KEY),
  }),
})

const destination = process.argv[2] || join(process.cwd(), 'export-medias-exercices')

async function main() {
  console.log(`\n🎯 Projet : ${env.FIREBASE_PROJECT_ID}`)
  console.log(`📁 Destination : ${destination}\n`)
  mkdirSync(destination, { recursive: true })

  const snap = await admin.firestore().collection('exercices').get()

  // Une entrée par FICHIER (pas par exercice) : un média repris n'est pris qu'une fois.
  const fichiers = new Map()   // url → { nom, exercices: [] }
  snap.forEach((d) => {
    const ex = { id: d.id, ...d.data() }
    for (const champ of ['image_exercice', 'video_exercice']) {
      const url = ex[champ]
      if (!url) continue
      if (!fichiers.has(url)) fichiers.set(url, { nom: ex.nom_exercice ?? d.id, exercices: [] })
      fichiers.get(url).exercices.push(ex.nom_exercice ?? d.id)
    }
  })

  console.log(`🏋️  ${snap.size} exercices, ${fichiers.size} fichiers distincts à récupérer.\n`)

  const lignes = ['fichier;exercices;url']
  let ok = 0, erreurs = 0, deja = 0
  const prisEnCompte = new Set()

  for (const [url, info] of fichiers) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())

      let nom = nomFichier(info.nom, extDepuis(res.headers.get('content-type'), url))
      // Deux exercices homonymes ne doivent pas s'écraser l'un l'autre.
      let n = 2
      while (prisEnCompte.has(nom)) {
        nom = nom.replace(/(\.[a-z0-9]+)$/i, `-${n++}$1`)
      }
      prisEnCompte.add(nom)

      const chemin = join(destination, nom)
      if (existsSync(chemin)) deja++
      writeFileSync(chemin, buf)
      lignes.push(`${nom};${info.exercices.join(' | ')};${url}`)
      ok++
      console.log(`   ✅ ${nom}  (${(buf.length / 1024).toFixed(0)} Ko)${info.exercices.length > 1 ? `  — partagé par ${info.exercices.length} exercices` : ''}`)
    } catch (e) {
      erreurs++
      console.log(`   ❌ ${info.nom} : ${e.message}`)
      lignes.push(`ÉCHEC;${info.exercices.join(' | ')};${url}`)
    }
  }

  writeFileSync(join(destination, 'index.csv'), lignes.join('\n'), 'utf8')
  console.log(`\n✅ ${ok} fichiers enregistrés${deja ? ` (dont ${deja} écrasés)` : ''}, ${erreurs} en échec.`)
  console.log(`📄 Récapitulatif : ${join(destination, 'index.csv')}\n`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

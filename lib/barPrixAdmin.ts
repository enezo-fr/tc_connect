import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { COLL, RAYON_M, distanceM, type Position } from '@/lib/barPrixCore'

/** Version Admin SDK du catalogue de prix (pour la page publique, sans auth client). */

export async function chargerBarProcheAdmin(pos: Position): Promise<{ cell: string; nom?: string; prix: Record<string, number> } | null> {
  const i = Math.round(pos.lat / 0.0005), j = Math.round(pos.lng / 0.0005)
  const keys: string[] = []
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) keys.push(`${i + di}_${j + dj}`)

  const snap = await getAdminDb().collection(COLL).where(FieldPath.documentId(), 'in', keys).get()
  let best: { cell: string; nom?: string; prix: Record<string, number> } | null = null
  let bestD = Infinity
  for (const d of snap.docs) {
    const x = d.data() as { lat?: number; lng?: number; nom?: string; prix?: Record<string, number> }
    if (typeof x.lat !== 'number' || typeof x.lng !== 'number') continue
    const dist = distanceM(pos, { lat: x.lat, lng: x.lng })
    if (dist <= RAYON_M && dist < bestD) { bestD = dist; best = { cell: d.id, nom: x.nom, prix: x.prix ?? {} } }
  }
  return best
}

export async function enregistrerPrixAdmin(args: {
  cell: string; pos: Position; nom?: string; boisson: string; prix: number; by?: string
}): Promise<void> {
  const cle = args.boisson.trim().toLowerCase()
  await getAdminDb().collection(COLL).doc(args.cell).set({
    lat: args.pos.lat,
    lng: args.pos.lng,
    ...(args.nom ? { nom: args.nom } : {}),
    prix: { [cle]: args.prix },
    histo: FieldValue.arrayUnion({ boisson: args.boisson.trim(), prix: args.prix, at: Timestamp.now(), by: args.by ?? 'public' }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

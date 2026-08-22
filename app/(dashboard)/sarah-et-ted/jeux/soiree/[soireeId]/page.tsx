'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import ConfirmSuppression, { type CibleSuppression } from '@/components/ui/ConfirmSuppression'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import CartePartie from '@/components/duo/jeux/CartePartie'
import ClassementSoiree from '@/components/duo/jeux/ClassementSoiree'
import StatsJeux from '@/components/duo/jeux/StatsJeux'
import { changerBaremeSoiree, delierPartie, renommerSoiree } from '@/lib/duoJeuxDb'
import { baremeDeSoiree, partiesDeSoiree, type BaremeSoiree } from '@/lib/duoJeux'
import { ArrowLeft, Pencil, Plus, Trash2, Check, X } from 'lucide-react'

/**
 * Une soirée jeux : plusieurs parties, éventuellement de jeux différents, et UN
 * classement général.
 *
 * La soirée n'est pas un document : elle n'existe que par le `soireeId` porté par
 * ses parties. La dissoudre revient donc à les détacher — aucune partie n'est
 * supprimée au passage, et c'est dit tel quel dans la confirmation.
 */
export default function SoireePage() {
  const { soireeId } = useParams<{ soireeId: string }>()
  const router = useRouter()
  const { items, loading, partagees, bypass } = useDuoJeux()

  const parties = useMemo(() => partiesDeSoiree(items, soireeId), [items, soireeId])
  const bareme = useMemo(() => baremeDeSoiree(parties), [parties])
  const nom = parties.find((p) => p.soireeName)?.soireeName ?? 'Soirée jeux'
  const jeux = useMemo(() => [...new Set(parties.map((p) => p.jeu).filter(Boolean))], [parties])
  const partageeIds = useMemo(() => new Set(partagees.map((p) => p.id)), [partagees])

  const [renommage, setRenommage] = useState<string | null>(null)
  const [aSupprimer, setASupprimer] = useState<CibleSuppression | null>(null)
  const [busy, setBusy] = useState(false)

  const renommer = async () => {
    const nouveau = (renommage ?? '').trim()
    if (!nouveau) { setRenommage(null); return }
    setBusy(true)
    try { await renommerSoiree(parties, nouveau); setRenommage(null) }
    finally { setBusy(false) }
  }

  const changerBareme = (b: BaremeSoiree) => changerBaremeSoiree(parties, b)

  const dissoudre = () => setASupprimer({
    quoi: `la soirée « ${nom} »`,
    detail: `Les ${parties.length} parties sont conservées : elles redeviennent simplement indépendantes.`,
    libelleBouton: 'Dissoudre',
    go: async () => {
      await Promise.all(parties.map((p) => delierPartie(p.id)))
      router.push('/sarah-et-ted/jeux')
    },
  })

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-5">
        {/* En-tête */}
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/sarah-et-ted/jeux')} aria-label="Retour aux jeux"
            className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 break-words">{nom}</h1>
            <p className="text-sm text-gray-500 mt-1 break-words">
              {`${parties.length} partie${parties.length > 1 ? 's' : ''}`}
              {jeux.length > 0 && ` · ${jeux.join(', ')}`}
            </p>
          </div>
          {parties.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => router.push(`/sarah-et-ted/jeux/nouvelle?soiree=${soireeId}`)}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-2 rounded-xl shadow-sm transition">
                <Plus size={16} /><span className="hidden sm:inline">Ajouter une partie</span>
              </button>
              <button onClick={() => setRenommage(nom)} aria-label="Renommer la soirée"
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <Pencil size={16} />
              </button>
              <button onClick={dissoudre} aria-label="Dissoudre la soirée"
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>

        {renommage !== null && (
          <div className="flex gap-2">
            <input autoFocus value={renommage} onChange={(e) => setRenommage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') renommer(); if (e.key === 'Escape') setRenommage(null) }}
              placeholder="Nom de la soirée"
              className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-400" />
            <button onClick={renommer} disabled={busy} aria-label="Enregistrer le nom"
              className="shrink-0 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
              <Check size={15} />Enregistrer
            </button>
            <button onClick={() => setRenommage(null)} aria-label="Annuler"
              className="shrink-0 border border-gray-300 text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-50 transition">
              <X size={15} />
            </button>
          </div>
        )}

        {loading && parties.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : parties.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <p className="text-sm text-gray-400">Cette soirée ne contient aucune partie.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <ClassementSoiree parties={parties} bareme={bareme} onBareme={changerBareme} />

            <div className="space-y-5">
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">Parties, dans l&apos;ordre</h2>
                <div className="space-y-2">
                  {parties.map((p) => (
                    <CartePartie key={p.id} partie={p} partagee={partageeIds.has(p.id)} />
                  ))}
                </div>
              </section>

              <StatsJeux parties={parties} titre="Statistiques de la soirée" avecAide={false} />
            </div>
          </div>
        )}
      </div>

      <ConfirmSuppression cible={aSupprimer} onClose={() => setASupprimer(null)} />
    </StoreGate>
  )
}

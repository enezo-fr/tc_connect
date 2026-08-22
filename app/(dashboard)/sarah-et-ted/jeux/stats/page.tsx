'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import { LigneAide } from '@/components/ui/NoteAide'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import StatsJeux from '@/components/duo/jeux/StatsJeux'
import ClassementSoiree from '@/components/duo/jeux/ClassementSoiree'
import { BAREMES, cumulPointsPossible, jeuxJoues, type BaremeSoiree } from '@/lib/duoJeux'
import { ArrowLeft } from 'lucide-react'

const chipCls = (actif: boolean) =>
  `px-3 py-1.5 rounded-xl text-sm border transition ${
    actif ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
  }`

/**
 * Statistiques, avec le cumul par jeu.
 *
 * Choisir un jeu additionne TOUTES ses parties, quelle que soit la soirée : c'est
 * le classement « de la maison » à l'Uno ou au SkyJo. Comme il n'y a qu'un seul
 * jeu, les points bruts se comparent, et le barème « Points cumulés » redevient
 * possible.
 */
export default function StatsJeuxPage() {
  const router = useRouter()
  const { items, loading, bypass } = useDuoJeux()

  const [jeu, setJeu] = useState('')
  const [bareme, setBareme] = useState<BaremeSoiree>('points')

  const jeux = useMemo(() => jeuxJoues(items), [items])
  const filtrees = useMemo(() => (jeu ? items.filter((p) => p.jeu === jeu) : items), [items, jeu])
  const pointsPossible = useMemo(() => cumulPointsPossible(filtrees), [filtrees])

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/sarah-et-ted/jeux')} aria-label="Retour aux jeux"
            className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Statistiques</h1>
            <p className="text-sm text-gray-500 mt-1">
              {jeu ? `Toutes les parties de ${jeu}, cumulées.` : 'Toutes parties confondues.'}
            </p>
          </div>
        </div>

        {/* Filtre par jeu */}
        {jeux.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cumuler</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setJeu('')} className={chipCls(!jeu)}>Tous les jeux</button>
              {jeux.map((j) => (
                <button key={j} type="button" onClick={() => setJeu(j)} className={chipCls(jeu === j)}>{j}</button>
              ))}
            </div>
            <LigneAide>
              Choisissez un jeu pour additionner toutes ses parties, toutes soirées confondues.
            </LigneAide>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {/* Classement cumulé du jeu choisi */}
            {jeu ? (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Comment on compte</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BAREMES.map((b) => {
                      const bloque = b.cle === 'points' && !pointsPossible
                      return (
                        <button key={b.cle} type="button" disabled={bloque}
                          onClick={() => setBareme(b.cle)}
                          className={`px-3 py-1.5 rounded-xl text-sm border transition ${
                            bareme === b.cle ? 'bg-rose-600 text-white border-rose-600'
                              : bloque ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                : 'border-gray-200 text-gray-700 hover:border-rose-300'
                          }`}>
                          {b.nom}
                        </button>
                      )
                    })}
                  </div>
                  <LigneAide>{BAREMES.find((b) => b.cle === bareme)?.aide}</LigneAide>
                </div>
                <ClassementSoiree parties={filtrees} bareme={pointsPossible ? bareme : 'places'} />
              </div>
            ) : (
              <ClassementSoiree parties={filtrees} bareme="victoires" />
            )}

            <StatsJeux parties={filtrees} titre={jeu ? `Détail — ${jeu}` : 'Détail'} />
          </div>
        )}
      </div>
    </StoreGate>
  )
}

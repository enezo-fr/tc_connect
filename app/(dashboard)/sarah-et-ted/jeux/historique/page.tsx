'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import CartePartie from '@/components/duo/jeux/CartePartie'
import { joueursConnus, jeuxJoues, partieJouee } from '@/lib/duoJeux'
import { ArrowLeft, Search } from 'lucide-react'

const chipCls = (actif: boolean) =>
  `px-3 py-1.5 rounded-xl text-sm border transition ${
    actif ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-700 hover:border-rose-300'
  }`

/** Toutes les parties, avec de quoi retrouver celle qu'on cherche. */
export default function HistoriqueJeuxPage() {
  const router = useRouter()
  const { items, loading, partagees, bypass } = useDuoJeux()

  const [recherche, setRecherche] = useState('')
  const [jeu, setJeu] = useState('')
  const [joueur, setJoueur] = useState('')
  const [etat, setEtat] = useState<'toutes' | 'en_cours' | 'terminees'>('toutes')

  const jeux = useMemo(() => jeuxJoues(items), [items])
  const joueurs = useMemo(() => joueursConnus(items), [items])
  const partageeIds = useMemo(() => new Set(partagees.map((p) => p.id)), [partagees])

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return items.filter((p) => {
      if (jeu && p.jeu !== jeu) return false
      if (joueur && !(p.joueurs ?? []).includes(joueur)) return false
      if (etat === 'en_cours' && p.termine) return false
      if (etat === 'terminees' && !p.termine) return false
      if (q && !`${p.jeu} ${(p.joueurs ?? []).join(' ')} ${p.soireeName ?? ''} ${p.infos ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, recherche, jeu, joueur, etat])

  const jouees = liste.filter(partieJouee).length

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/sarah-et-ted/jeux')} aria-label="Retour aux jeux"
            className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Historique</h1>
            <p className="text-sm text-gray-500 mt-1">
              {`${liste.length} partie${liste.length > 1 ? 's' : ''} · ${jouees} avec un résultat`}
            </p>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Un jeu, un joueur, une session…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
        </div>

        <div className="space-y-2">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {([['toutes', 'Toutes'], ['en_cours', 'En cours'], ['terminees', 'Terminées']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setEtat(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  etat === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}>
                {l}
              </button>
            ))}
          </div>

          {jeux.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {jeux.map((j) => (
                <button key={j} onClick={() => setJeu(jeu === j ? '' : j)} className={chipCls(jeu === j)}>{j}</button>
              ))}
            </div>
          )}

          {joueurs.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {joueurs.map((j) => (
                <button key={j} onClick={() => setJoueur(joueur === j ? '' : j)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                    joueur === j ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}>
                  {j}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : liste.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-400">Aucune partie ne correspond.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {liste.map((p) => (
              <CartePartie key={p.id} partie={p} partagee={partageeIds.has(p.id)} />
            ))}
          </div>
        )}
      </div>
    </StoreGate>
  )
}

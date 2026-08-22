'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import CartePartie from '@/components/duo/jeux/CartePartie'
import {
  classementSoiree, ecartSoiree, partieJouee, soireesDe, statsJoueurs,
} from '@/lib/duoJeux'
import {
  ChevronLeft, ChevronRight, Plus, BarChart3, Dices, CalendarDays, Trophy, Clock,
} from 'lucide-react'

const couleurRang = (rang: number) =>
  rang === 1 ? 'bg-amber-100 text-amber-700'
    : rang === 2 ? 'bg-gray-200 text-gray-600'
      : 'bg-orange-100 text-orange-700'

/**
 * Accueil du module Jeux.
 *
 * Trois entrées, dans l'ordre où on s'en sert un soir de jeux : la partie en
 * cours, la soirée qui les regroupe, puis l'archive. Chaque partie mène à SA
 * page — l'ancienne liste dépliable devenait illisible dès quelques parties.
 */
export default function JeuxPage() {
  const router = useRouter()
  const { items, loading, partagees, bypass } = useDuoJeux()

  const partageeIds = useMemo(() => new Set(partagees.map((p) => p.id)), [partagees])
  const enCours = useMemo(() => items.filter((p) => !p.termine), [items])
  const terminees = useMemo(() => items.filter((p) => p.termine), [items])
  const soirees = useMemo(() => soireesDe(items), [items])
  const podium = useMemo(() => statsJoueurs(items).slice(0, 3), [items])
  const nbJouees = useMemo(() => items.filter(partieJouee).length, [items])

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-6">
        {/* En-tête : retour, titre à gauche, actions à droite */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button onClick={() => router.push('/sarah-et-ted')}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition mb-1">
              <ChevronLeft size={14} />Sarah &amp; Ted
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Jeux</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {items.length === 0
                ? 'Les scores de vos parties, soirée par soirée.'
                : `${items.length} partie${items.length > 1 ? 's' : ''} · ${nbJouees} avec un résultat`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => router.push('/sarah-et-ted/jeux/stats')}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 text-sm font-medium px-3 py-2 rounded-xl transition">
              <BarChart3 size={16} /><span className="hidden sm:inline">Statistiques</span>
            </button>
            <button onClick={() => router.push('/sarah-et-ted/jeux/nouvelle')}
              className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-2 rounded-xl shadow-sm transition">
              <Plus size={16} />Nouvelle partie
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center">
            <Dices size={30} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-1">Aucune partie enregistrée.</p>
            <p className="text-xs text-gray-400 mb-4">
              Créez-en une, partagez le lien à la table, et les scores se remplissent à plusieurs.
            </p>
            <button onClick={() => router.push('/sarah-et-ted/jeux/nouvelle')}
              className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition">
              <Plus size={16} />Nouvelle partie
            </button>
          </div>
        ) : (
          <>
            {/* Podium tous jeux confondus */}
            {podium.length > 0 && podium[0].victoires > 0 && (
              <button onClick={() => router.push('/sarah-et-ted/jeux/stats')}
                className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Trophy size={13} />Palmarès — toutes parties
                  </p>
                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </div>
                <div className="space-y-1.5">
                  {podium.map((j, i) => (
                    <div key={j.joueur} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${couleurRang(i + 1)}`}>
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 text-sm text-gray-700 break-words">{j.joueur}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        <strong className="text-gray-800">{j.victoires}</strong>
                        {` victoire${j.victoires > 1 ? 's' : ''} / ${j.parties}`}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            )}

            {/* Parties en cours */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">
                {`Parties en cours${enCours.length ? ` · ${enCours.length}` : ''}`}
              </h2>
              {enCours.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
                  <p className="text-sm text-gray-400">Aucune partie en cours.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {enCours.map((p) => (
                    <CartePartie key={p.id} partie={p} partagee={partageeIds.has(p.id)} />
                  ))}
                </div>
              )}
            </section>

            {/* Soirées */}
            {soirees.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">{`Soirées · ${soirees.length}`}</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {soirees.map((s) => {
                    const ecart = ecartSoiree(classementSoiree(s.parties, s.bareme))
                    return (
                      <button key={s.soireeId}
                        onClick={() => router.push(`/sarah-et-ted/jeux/soiree/${s.soireeId}`)}
                        className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md hover:border-rose-200 transition text-left">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 break-words flex items-center gap-1.5">
                            <CalendarDays size={14} className="text-gray-300 shrink-0" />{s.nom}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 break-words">
                            {`${s.parties.length} partie${s.parties.length > 1 ? 's' : ''}`}
                            {s.jeux.length > 0 && ` · ${s.jeux.join(', ')}`}
                          </p>
                          {ecart && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {ecart.ecart === 0
                                ? `${ecart.enTete.joueur} et ${ecart.second.joueur} à égalité`
                                : `${ecart.enTete.joueur} devant, +${ecart.ecart}`}
                            </p>
                          )}
                        </div>
                        <ChevronRight size={20} className="text-gray-300 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Dernières parties terminées */}
            {terminees.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-gray-700">Dernières parties terminées</h2>
                  <button onClick={() => router.push('/sarah-et-ted/jeux/historique')}
                    className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 transition shrink-0">
                    <Clock size={13} />Tout l&apos;historique
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {terminees.slice(0, 4).map((p) => (
                    <CartePartie key={p.id} partie={p} partagee={partageeIds.has(p.id)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </StoreGate>
  )
}

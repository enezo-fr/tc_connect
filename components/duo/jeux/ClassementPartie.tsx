'use client'

import { useMemo } from 'react'
import { Trophy, Target } from 'lucide-react'
import { classementPartie, objectifAtteint, partieJouee, totalJoueur } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/** Médaille du podium — au-delà, un simple numéro gris. */
const couleurRang = (rang: number) =>
  rang === 1 ? 'bg-amber-100 text-amber-700'
    : rang === 2 ? 'bg-gray-200 text-gray-600'
      : rang === 3 ? 'bg-orange-100 text-orange-700'
        : 'bg-gray-50 text-gray-400'

/**
 * Le tableau des scores d'une partie : classement, écart avec le leader et
 * progression vers l'objectif s'il y en a un.
 *
 * Sert dans l'app comme sur la page publique du lien de partage — d'où l'absence
 * totale d'accès Firestore ici.
 */
export default function ClassementPartie({ partie, compact = false }: {
  partie: DuoPartie
  /** Version resserrée pour une carte de liste. */
  compact?: boolean
}) {
  const lignes = useMemo(() => classementPartie(partie), [partie])
  const jouee = partieJouee(partie)
  const cible = partie.objectif ?? 0
  const atteint = objectifAtteint(partie)

  const meilleur = lignes.find((l) => l.classe)?.total ?? 0

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Classement</p>
        <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${
          partie.termine ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
            : 'bg-rose-50 text-rose-700 border border-rose-100'
        }`}>
          {partie.termine ? 'Terminée' : 'En cours'}
        </span>
      </div>

      {!jouee && (
        <p className="text-sm text-gray-400 mb-3">
          {partie.sansPoints
            ? "Personne n'est encore classé — indiquez l'ordre d'arrivée."
            : 'Aucun tour saisi : le classement arrive au premier score.'}
        </p>
      )}

      <div className="space-y-1.5">
        {lignes.map((l) => {
          const ecart = partie.sansPoints || !l.classe ? null : Math.abs(l.total - meilleur)
          return (
            <div key={l.joueur} className="flex items-center gap-3">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                l.classe ? couleurRang(l.rang) : 'bg-gray-50 text-gray-300'
              }`}>
                {l.classe ? l.rang : '—'}
              </span>
              <span className="flex-1 min-w-0 text-sm text-gray-800 break-words">
                {l.joueur}
                {l.classe && l.rang === 1 && jouee && (
                  <Trophy size={13} className="inline-block ml-1.5 -mt-0.5 text-amber-500" />
                )}
              </span>
              {!partie.sansPoints && (
                <span className="text-right shrink-0">
                  <span className="text-sm font-semibold text-gray-800 tabular-nums">{l.total}</span>
                  {ecart !== null && ecart > 0 && (
                    <span className="block text-[11px] text-gray-400 tabular-nums">{`-${ecart}`}</span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Objectif de score : où en est la partie */}
      {cible > 0 && !partie.sansPoints && (
        <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <Target size={13} className="text-rose-500" />
              {`Objectif ${cible} points`}
            </span>
            <span className={`text-xs font-medium ${atteint ? 'text-emerald-600' : 'text-gray-400'}`}>
              {atteint ? 'Atteint' : `${Math.max(...(partie.joueurs ?? []).map((j) => totalJoueur(partie, j)), 0)} / ${cible}`}
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${atteint ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, Math.round((Math.max(...(partie.joueurs ?? []).map((j) => totalJoueur(partie, j)), 0) / cible) * 100))}%` }} />
          </div>
        </div>
      )}

      {!compact && (
        <p className="text-[11px] text-gray-400 mt-3">
          {partie.sansPoints
            ? "Partie sans points : seul l'ordre d'arrivée compte."
            : partie.scoreBasGagne ? 'Le plus petit score gagne.' : 'Le plus grand score gagne.'}
        </p>
      )}
    </div>
  )
}

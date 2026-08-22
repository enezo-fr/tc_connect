'use client'

import { useMemo } from 'react'
import { Trophy } from 'lucide-react'
import { LigneAide } from '@/components/ui/NoteAide'
import {
  BAREMES, classementSoiree, cumulPointsPossible, ecartSoiree, type BaremeSoiree,
} from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

const couleurRang = (rang: number) =>
  rang === 1 ? 'bg-amber-100 text-amber-700'
    : rang === 2 ? 'bg-gray-200 text-gray-600'
      : rang === 3 ? 'bg-orange-100 text-orange-700'
        : 'bg-gray-50 text-gray-400'

/**
 * Classement général d'une soirée, TOUS JEUX CONFONDUS.
 *
 * Le barème est le cœur du sujet : on ne peut pas additionner 500 points d'Uno
 * et 32 de SkyJo. « Victoires » et « Places » ramènent chaque partie à un
 * résultat comparable ; « Points cumulés » n'est proposé que lorsque toutes les
 * parties sont le même jeu, joué dans le même sens.
 */
export default function ClassementSoiree({ parties, bareme, onBareme }: {
  parties: DuoPartie[]
  bareme: BaremeSoiree
  /** Absent = lecture seule (page publique, aperçu). */
  onBareme?: (b: BaremeSoiree) => void
}) {
  const lignes = useMemo(() => classementSoiree(parties, bareme), [parties, bareme])
  const ecart = useMemo(() => ecartSoiree(lignes), [lignes])
  const pointsPossible = useMemo(() => cumulPointsPossible(parties), [parties])
  const aide = BAREMES.find((b) => b.cle === bareme)?.aide

  return (
    <div className="space-y-3">
      {/* Choix du barème */}
      {onBareme && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Comment on compte
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BAREMES.map((b) => {
              const bloque = b.cle === 'points' && !pointsPossible
              const actif = bareme === b.cle
              return (
                <button key={b.cle} type="button" disabled={bloque}
                  onClick={() => onBareme(b.cle)}
                  title={bloque ? 'Disponible seulement si toutes les parties sont le même jeu' : b.aide}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition ${
                    actif ? 'bg-rose-600 text-white border-rose-600'
                      : bloque ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                        : 'border-gray-200 text-gray-700 hover:border-rose-300'
                  }`}>
                  {b.nom}
                </button>
              )
            })}
          </div>
          {aide && <LigneAide>{aide}</LigneAide>}
          {!pointsPossible && (
            <LigneAide>
              Les <strong>points cumulés</strong> sont désactivés : cette soirée mélange plusieurs jeux
              (ou une partie sans points), et leurs scores ne se comparent pas.
            </LigneAide>
          )}
        </div>
      )}

      {/* Écart en tête */}
      {ecart && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Écart en tête
          </p>
          <p className="text-4xl font-bold text-rose-600 tabular-nums">
            {ecart.ecart === 0 ? '—' : `+${ecart.ecart}`}
          </p>
          <p className="text-sm text-gray-600 mt-1.5">
            {ecart.ecart === 0
              ? `${ecart.enTete.joueur} et ${ecart.second.joueur} sont à égalité`
              : <>en faveur de <span className="font-semibold text-gray-800">{ecart.enTete.joueur}</span></>}
          </p>
        </div>
      )}

      {/* Classement */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">
          Classement général
        </p>
        {lignes.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-400">Aucun joueur pour l&apos;instant.</p>
        ) : lignes.map((l) => (
          <div key={l.joueur} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${couleurRang(l.rang)}`}>
              {l.rang}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 break-words">
                {l.joueur}
                {l.rang === 1 && <Trophy size={13} className="inline-block ml-1.5 -mt-0.5 text-amber-500" />}
              </p>
              <p className="text-xs text-gray-400">
                {`${l.parties} partie${l.parties > 1 ? 's' : ''} · ${l.victoires} victoire${l.victoires > 1 ? 's' : ''}`}
                {l.podiums > l.victoires && ` · ${l.podiums} podiums`}
              </p>
            </div>
            <span className="text-lg font-bold text-rose-600 tabular-nums shrink-0">{l.points}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

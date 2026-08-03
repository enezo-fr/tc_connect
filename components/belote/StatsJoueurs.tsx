'use client'

import { useMemo } from 'react'
import { NoteAide } from '@/components/ui/NoteAide'
import { statsEquipes, statsJoueurs, type PartieAvecTours } from '@/lib/belote/stats'

interface Props {
  parties: PartieAvecTours[]
  /** Titre de la section (« Statistiques », « Sur la série »…). */
  titre?: string
  /** Masque l'encart d'aide sur les écrans où il ferait doublon. */
  avecAide?: boolean
}

/** Petit chiffre légendé, réutilisé dans les deux tableaux. */
function Chiffre({ valeur, legende, couleur = 'text-gray-800' }: {
  valeur: string | number
  legende: string
  couleur?: string
}) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold tabular-nums leading-tight ${couleur}`}>{valeur}</p>
      <p className="text-[11px] text-gray-400 leading-tight">{legende}</p>
    </div>
  )
}

/**
 * Statistiques de prise par joueur : qui prend, qui réussit, qui se met dedans.
 * Marche sur une partie comme sur toute une série.
 */
export default function StatsJoueurs({ parties, titre = 'Statistiques', avecAide = true }: Props) {
  const joueurs = useMemo(() => statsJoueurs(parties), [parties])
  const equipes = useMemo(() => statsEquipes(parties), [parties])
  const totalPrises = joueurs.reduce((n, j) => n + j.prises, 0)

  if (totalPrises === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <p className="text-sm text-gray-400">Les statistiques arrivent dès le premier tour joué.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">{titre}</h2>

      {/* Par équipe */}
      <div className="grid grid-cols-2 gap-3">
        {equipes.map((e) => (
          <div key={e.slot} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-800 truncate mb-2">{e.nom}</p>
            <div className="grid grid-cols-3 gap-2">
              <Chiffre valeur={e.prises} legende="prises" />
              <Chiffre valeur={e.dedans} legende="dedans" couleur={e.dedans > 0 ? 'text-red-500' : 'text-gray-300'} />
              <Chiffre valeur={e.taux != null ? `${e.taux}%` : '—'} legende="réussite" couleur="text-blue-600" />
            </div>
            {(e.capots > 0 || e.belotes > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {e.capots > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                    {e.capots} capot{e.capots > 1 ? 's' : ''}
                  </span>
                )}
                {e.belotes > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                    {e.belotes} belote{e.belotes > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Par joueur */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-1">
          Par joueur
        </p>
        {joueurs.map((j) => (
          <div key={j.nom} className="px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 break-words">{j.nom}</p>
                {j.equipeNom && <p className="text-xs text-gray-400 break-words">{j.equipeNom}</p>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <Chiffre valeur={j.prises} legende="prises" />
                <Chiffre valeur={j.dedans} legende="dedans"
                  couleur={j.dedans > 0 ? 'text-red-500' : 'text-gray-300'} />
                <Chiffre valeur={j.taux != null ? `${j.taux}%` : '—'} legende="réussite" couleur="text-blue-600" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-400">
              {j.moyenne != null && <span>{j.moyenne} pts en moyenne par prise</span>}
              {j.capots > 0 && <span className="text-purple-600">{j.capots} capot{j.capots > 1 ? 's' : ''}</span>}
              {j.capotsSubis > 0 && <span className="text-red-400">{j.capotsSubis} capot{j.capotsSubis > 1 ? 's' : ''} encaissé{j.capotsSubis > 1 ? 's' : ''}</span>}
              {j.distributions > 0 && <span>{j.distributions} distribution{j.distributions > 1 ? 's' : ''}</span>}
              {j.prises === 0 && <span className="italic">n&apos;a jamais pris</span>}
            </div>
          </div>
        ))}
      </div>

      {avecAide && (
        <NoteAide titre="Comment lire ces chiffres ?">
          <p><strong>Prises</strong> : le nombre de fois où le joueur a pris l&apos;atout.</p>
          <p>
            <strong>Dedans</strong> : parmi ses prises, celles où son équipe a chuté — elle n&apos;a pas
            atteint le contrat, et l&apos;adversaire empoche la donne.
          </p>
          <p><strong>Réussite</strong> : la part de ses prises qui ne finissent pas dedans.</p>
          <p>
            La <strong>moyenne par prise</strong> compte les points marqués par son équipe sur les tours
            où c&apos;est lui qui a pris.
          </p>
          <p className="text-sky-900/60">
            Un joueur n&apos;apparaît avec une équipe que si la partie connaît sa composition ; les
            distributions sont comptées même sans prise.
          </p>
        </NoteAide>
      )}
    </div>
  )
}

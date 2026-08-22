'use client'

import { useMemo } from 'react'
import { Flame, Crown, Dices, Swords } from 'lucide-react'
import { NoteAide } from '@/components/ui/NoteAide'
import {
  duoVedette, faceAFace, partieJouee, statsJoueurs, statsParJeu,
} from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/** Libellé « 2 victoires » construit d'un seul tenant (l'espace saute après une expression JSX). */
const libelle = (n: number, singulier: string, pluriel = `${singulier}s`) =>
  `${n} ${n > 1 ? pluriel : singulier}`

function Chiffre({ valeur, legende, couleur = 'text-gray-800' }: {
  valeur: string | number; legende: string; couleur?: string
}) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold tabular-nums leading-tight ${couleur}`}>{valeur}</p>
      <p className="text-[11px] text-gray-400 leading-tight">{legende}</p>
    </div>
  )
}

/**
 * Statistiques d'un lot de parties : sur toute l'histoire, sur une soirée, ou sur
 * un seul jeu — c'est l'appelant qui choisit ce qu'il envoie.
 */
export default function StatsJeux({ parties, titre = 'Statistiques', avecAide = true }: {
  parties: DuoPartie[]
  titre?: string
  avecAide?: boolean
}) {
  const jouees = useMemo(() => parties.filter(partieJouee), [parties])
  const joueurs = useMemo(() => statsJoueurs(parties), [parties])
  const jeux = useMemo(() => statsParJeu(parties), [parties])
  const duel = useMemo(() => {
    const paire = duoVedette(jouees)
    return paire ? faceAFace(jouees, paire[0], paire[1]) : null
  }, [jouees])

  if (jouees.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <Dices size={26} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">Les statistiques arrivent dès la première partie jouée.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">{titre}</h2>

      {/* Bandeau */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="grid grid-cols-3 gap-3">
          <Chiffre valeur={jouees.length} legende={jouees.length > 1 ? 'parties jouées' : 'partie jouée'} />
          <Chiffre valeur={jeux.length} legende={jeux.length > 1 ? 'jeux différents' : 'jeu'} couleur="text-rose-600" />
          <Chiffre valeur={joueurs.length} legende={joueurs.length > 1 ? 'joueurs' : 'joueur'} />
        </div>
      </div>

      {/* Le duel de la maison */}
      {duel && duel.parties > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Swords size={13} />Face à face
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-center flex-1">
              <p className="text-sm font-semibold text-gray-800 truncate">{duel.a}</p>
              <p className="text-2xl font-bold text-rose-600 tabular-nums">{duel.victoiresA}</p>
            </div>
            <span className="text-xs text-gray-300 shrink-0">vs</span>
            <div className="min-w-0 text-center flex-1">
              <p className="text-sm font-semibold text-gray-800 truncate">{duel.b}</p>
              <p className="text-2xl font-bold text-gray-700 tabular-nums">{duel.victoiresB}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-center mt-2">
            {`Sur ${libelle(duel.parties, 'partie')} jouées ensemble`}
            {duel.autres > 0 && ` · ${libelle(duel.autres, 'gagnée par quelqu’un d’autre', 'gagnées par quelqu’un d’autre')}`}
          </p>
        </div>
      )}

      {/* Par joueur */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-1">Par joueur</p>
        {joueurs.map((j) => (
          <div key={j.joueur} className="px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-800 break-words min-w-0">{j.joueur}</p>
              <div className="flex items-center gap-4 shrink-0">
                <Chiffre valeur={j.victoires} legende="victoires" couleur="text-amber-600" />
                <Chiffre valeur={j.parties} legende="parties" />
                <Chiffre valeur={j.taux != null ? `${j.taux}%` : '—'} legende="réussite" couleur="text-rose-600" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {j.serieEnCours > 1 && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                  <Flame size={11} />{`${j.serieEnCours} d'affilée`}
                </span>
              )}
              {j.jeuFavori && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium">
                  <Crown size={11} />{`imbattable au ${j.jeuFavori.jeu}`}
                </span>
              )}
              {j.record && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                  {`record ${j.record.points} au ${j.record.jeu}`}
                </span>
              )}
              {j.podiums > j.victoires && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 font-medium">
                  {libelle(j.podiums, 'podium')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Par jeu */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-1">Par jeu</p>
        {jeux.map((g) => (
          <div key={g.jeu} className="px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 break-words">{g.jeu}</p>
                <p className="text-xs text-gray-400">
                  {`${libelle(g.parties, 'partie')} · ${libelle(g.joueurs, 'joueur')}`}
                  {g.sansPoints ? ' · sans points' : g.scoreBasGagne ? ' · le plus petit gagne' : ''}
                </p>
              </div>
              {g.meilleur && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-gray-800 truncate max-w-[8rem]">{g.meilleur.joueur}</p>
                  <p className="text-[11px] text-gray-400">{libelle(g.meilleur.victoires, 'victoire')}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {g.tenant && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                  <Crown size={11} />{`tenant du titre : ${g.tenant}`}
                </span>
              )}
              {g.record && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                  {`record ${g.record.points} — ${g.record.joueur}`}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {avecAide && (
        <NoteAide titre="Comment lire ces chiffres ?">
          <p><strong>Réussite</strong> : la part des parties jouées que le joueur a gagnées.</p>
          <p>
            <strong>D&apos;affilée</strong> : ses victoires consécutives sur les dernières parties, dans
            l&apos;ordre où elles ont été jouées. La série retombe à zéro dès une défaite.
          </p>
          <p>
            <strong>Imbattable à…</strong> : le jeu où il gagne le plus souvent, à partir de deux parties
            — en dessous, ça ne veut encore rien dire.
          </p>
          <p>
            <strong>Record</strong> : le meilleur score jamais réalisé, dans le sens du jeu (le plus petit
            au SkyJo, le plus grand ailleurs). Les parties sans points n&apos;en ont pas.
          </p>
          <p className="text-sky-900/60">
            Seules les parties qui ont un résultat sont comptées : une partie créée mais jamais remplie
            n&apos;influence rien.
          </p>
        </NoteAide>
      )}
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import { NoteAide } from '@/components/ui/NoteAide'
import CourbePartie, { couleurJoueur } from '@/components/duo/jeux/CourbePartie'
import { statsPartie } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

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
 * Les statistiques d'UNE partie, manche par manche : tours gagnés, moyenne par
 * tour, régularité, temps passé en tête.
 *
 * Le tableau défile horizontalement dans sa propre boîte — à six joueurs et huit
 * colonnes sur un téléphone, la page elle-même ne doit pas partir de travers.
 */
export default function StatsPartie({ partie, avecAide = true }: {
  partie: DuoPartie
  avecAide?: boolean
}) {
  const { bilan, joueurs } = useMemo(() => statsPartie(partie), [partie])
  const index = useMemo(
    () => new Map((partie.joueurs ?? []).map((j, i) => [j, i])),
    [partie.joueurs],
  )

  // Une partie sans points n'a pas de manche à analyser : son classement, lui,
  // est déjà affiché juste au-dessus.
  if (partie.sansPoints || bilan.tours === 0) return null

  const colonnes: { cle: string; titre: string; valeur: (l: typeof joueurs[number]) => string }[] = [
    { cle: 'gagnes', titre: 'Tours gagnés', valeur: (l) => `${l.toursGagnes}${l.tauxTours != null ? ` · ${l.tauxTours}%` : ''}` },
    { cle: 'moy', titre: 'Moy./tour', valeur: (l) => (l.moyenne != null ? String(l.moyenne) : '—') },
    { cle: 'meilleur', titre: 'Meilleur tour', valeur: (l) => (l.meilleurTour != null ? String(l.meilleurTour) : '—') },
    { cle: 'pire', titre: 'Pire tour', valeur: (l) => (l.pireTour != null ? String(l.pireTour) : '—') },
    { cle: 'zeros', titre: 'Zéros', valeur: (l) => String(l.zeros) },
    { cle: 'regularite', titre: 'Régularité', valeur: (l) => (l.regularite != null ? `± ${l.regularite}` : '—') },
    { cle: 'serie', titre: 'Série', valeur: (l) => (l.serieTours > 1 ? `${l.serieTours} d'affilée` : '—') },
    { cle: 'tete', titre: 'Tours en tête', valeur: (l) => String(l.toursEnTete) },
    { cle: 'part', titre: 'Part des points', valeur: (l) => (l.partPoints != null ? `${l.partPoints}%` : '—') },
  ]

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Statistiques de la partie</h2>

      {/* Bilan général */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Chiffre valeur={bilan.tours} legende={bilan.tours > 1 ? 'tours joués' : 'tour joué'} />
          <Chiffre valeur={bilan.totalPoints} legende="points marqués" couleur="text-rose-600" />
          <Chiffre valeur={bilan.moyenneParTour ?? '—'} legende="moy. par tour et joueur" />
          <Chiffre valeur={bilan.changementsDeLeader} legende="changements de leader"
            couleur={bilan.changementsDeLeader > 0 ? 'text-amber-600' : 'text-gray-300'} />
        </div>
        {(bilan.tourRecord || bilan.ecart != null) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-dashed border-gray-100">
            {bilan.tourRecord && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                {`plus gros tour : ${bilan.tourRecord.points} — ${bilan.tourRecord.joueur} au tour ${bilan.tourRecord.index + 1}`}
              </span>
            )}
            {bilan.ecart != null && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium">
                {bilan.ecart === 0 ? 'les deux premiers sont à égalité' : `${bilan.ecart} points d'écart en tête`}
              </span>
            )}
          </div>
        )}
      </div>

      <CourbePartie partie={partie} />

      {/* Détail par joueur */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">
          Par joueur
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="text-left font-medium px-4 py-2 sticky left-0 bg-white z-10">Joueur</th>
                {colonnes.map((c) => (
                  <th key={c.cle} className="font-medium px-3 py-2 text-right whitespace-nowrap">{c.titre}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {joueurs.map((l) => (
                <tr key={l.joueur} className="border-t border-gray-50">
                  <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: couleurJoueur(index.get(l.joueur) ?? 0) }} />
                      <span className={`truncate max-w-[8rem] ${l.rang === 1 ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                        {l.joueur}
                      </span>
                    </span>
                  </td>
                  {colonnes.map((c) => (
                    <td key={c.cle} className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {c.valeur(l)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {avecAide && (
        <NoteAide titre="Comment lire ces chiffres ?">
          <p>
            <strong>Tours gagnés</strong> : les manches où le joueur a fait le meilleur score,
            dans le sens du jeu. Une manche où tout le monde marque pareil n&apos;est gagnée par personne.
          </p>
          <p>
            <strong>Meilleur / pire tour</strong> suivent aussi le sens du jeu : au SkyJo, le meilleur
            tour est le plus petit.
          </p>
          <p>
            <strong>Régularité</strong> : l&apos;écart type de ses manches. Petit, il joue toujours pareil ;
            grand, c&apos;est du tout ou rien.
          </p>
          <p>
            <strong>Tours en tête</strong> : le nombre de manches à l&apos;issue desquelles il était en
            première place. Mener longtemps ne veut pas dire gagner — d&apos;où les
            <strong> changements de leader</strong>.
          </p>
          <p>
            <strong>Part des points</strong> : sa part dans tous les points marqués sur la table.
          </p>
        </NoteAide>
      )}
    </div>
  )
}

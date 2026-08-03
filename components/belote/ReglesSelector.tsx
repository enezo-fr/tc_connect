'use client'

import { NoteAide } from '@/components/ui/NoteAide'
import type { BeloteRegles, RegleEgalite } from '@/lib/belote/types'

interface Props {
  valeur: BeloteRegles
  onChange: (regles: BeloteRegles) => void
  /** Prévient que des tours déjà joués vont être recalculés. */
  avertirRecalcul?: boolean
}

const EGALITE: [RegleEgalite, string, string][] = [
  ['litige', 'Litige', 'Personne ne marque : les points du preneur reviennent à qui gagne la donne suivante.'],
  ['dedans', 'Le preneur chute', "Il fallait faire mieux : l'adversaire empoche toute la donne."],
  ['preneur', 'Le preneur passe', 'La moitié suffit : chaque équipe garde ses points.'],
]

/**
 * Règles de table choisies POUR CETTE PARTIE : que faire à égalité, et la
 * belote-rebelote entre-t-elle dans le contrat. L'app applique ensuite le verdict
 * toute seule à chaque tour.
 */
export default function ReglesSelector({ valeur, onChange, avertirRecalcul = false }: Props) {
  const seuils = valeur.beloteDansContrat
    ? '82 en temps normal, 72 si le preneur a la belote, 92 si ce sont ses adversaires'
    : '82 dans tous les cas'

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Le preneur finit à égalité
        </label>
        <div className="space-y-1.5">
          {EGALITE.map(([k, titre, detail]) => {
            const actif = valeur.egalite === k
            return (
              <button key={k} type="button" onClick={() => onChange({ ...valeur, egalite: k })}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition ${
                  actif ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                }`}>
                <span className={`block text-sm font-medium ${actif ? 'text-blue-800' : 'text-gray-800'}`}>
                  {titre}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">{detail}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          La belote-rebelote compte pour le contrat
        </label>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([[false, 'Hors contrat'], [true, 'Elle compte']] as [boolean, string][]).map(([v, lbl]) => (
            <button key={lbl} type="button" onClick={() => onChange({ ...valeur, beloteDansContrat: v })}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                valeur.beloteDansContrat === v ? 'bg-white shadow text-gray-900' : 'text-gray-500'
              }`}>
              {lbl}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">Seuil du preneur : {seuils}.</p>
      </div>

      {avertirRecalcul && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Changer les règles en cours de partie recalcule les tours déjà joués.
        </p>
      )}

      <NoteAide titre="À quoi servent ces deux réglages ?">
        <p>
          Une donne vaut <strong>162 points</strong> et le preneur doit en faire plus de la moitié,
          soit <strong>82</strong>. À 81-81, les tables ne tranchent pas toutes pareil : c&apos;est le
          premier réglage.
        </p>
        <p>
          La <strong>belote-rebelote</strong> (Roi + Dame d&apos;atout) vaut 20 points à qui la
          détient, preneur ou non. Si elle <strong>compte pour le contrat</strong>, une belote chez
          l&apos;adversaire monte le seuil du preneur à 92 : il peut donc chuter avec 85 points aux
          cartes. Si elle est <strong>hors contrat</strong>, le seuil reste 82 et les 20 s&apos;ajoutent
          au tableau une fois le contrat jugé.
        </p>
        <p>
          Dans les deux cas, la belote <strong>reste acquise</strong> à qui la détient, même quand son
          équipe se met dedans.
        </p>
      </NoteAide>
    </div>
  )
}

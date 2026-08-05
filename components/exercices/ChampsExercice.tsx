'use client'

import { useState } from 'react'
import { PARTIES_CORPS, type PartieCorps, normalizePartieCorps } from '@/lib/exerciceOptions'

/**
 * Partie prioritaire : UN seul choix parmi les 4 zones du corps.
 * Une valeur ancienne (un muscle, avant la refonte) est ramenée à sa zone à l'affichage,
 * pour qu'un exercice pas encore converti n'apparaisse jamais « sans zone ».
 */
export function ChipsPartieCorps({
  valeur,
  onChange,
}: {
  valeur: string
  onChange: (v: PartieCorps) => void
}) {
  const actif = normalizePartieCorps(valeur)
  return (
    <div className="flex flex-wrap gap-1.5">
      {PARTIES_CORPS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={actif === p}
          className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
            actif === p
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

/**
 * Pastilles à sélection multiple (muscles, matériel).
 * Affiche aussi les valeurs déjà enregistrées absentes de la liste proposée : sans ça,
 * un ancien libellé resterait dans la fiche sans qu'on puisse le décocher.
 */
export function ChipsMulti({
  options,
  valeurs,
  onChange,
  couleur = 'blue',
  avecAutre = false,
  placeholderAutre = 'Autre…',
}: {
  options: string[]
  valeurs: string[]
  onChange: (v: string[]) => void
  couleur?: 'blue' | 'gray'
  /** Ajoute une pastille « Autre… » qui ouvre un champ libre (le matériel réel est souvent hors liste). */
  avecAutre?: boolean
  placeholderAutre?: string
}) {
  const [saisieOuverte, setSaisieOuverte] = useState(false)
  const [saisie, setSaisie] = useState('')

  const horsListe = valeurs.filter((v) => !options.includes(v))
  const actifClasse =
    couleur === 'blue'
      ? 'bg-blue-600 text-white border-blue-600'
      : 'bg-gray-700 text-white border-gray-700'

  const basculer = (v: string) =>
    onChange(valeurs.includes(v) ? valeurs.filter((x) => x !== v) : [...valeurs, v])

  const ajouterLibre = () => {
    const v = saisie.trim()
    if (v && !valeurs.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...valeurs, v])
    setSaisie('')
    setSaisieOuverte(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[...options, ...horsListe].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => basculer(m)}
            aria-pressed={valeurs.includes(m)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              valeurs.includes(m)
                ? actifClasse
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            {m}
          </button>
        ))}
        {avecAutre && !saisieOuverte && (
          <button
            type="button"
            onClick={() => setSaisieOuverte(true)}
            className="text-xs px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 transition"
          >
            + Autre…
          </button>
        )}
      </div>

      {avecAutre && saisieOuverte && (
        <div className="flex gap-2">
          <input
            type="text"
            autoFocus
            value={saisie}
            placeholder={placeholderAutre}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); ajouterLibre() }
              if (e.key === 'Escape') { setSaisie(''); setSaisieOuverte(false) }
            }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="button" onClick={ajouterLibre}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-white hover:bg-gray-800 transition">
            Ajouter
          </button>
        </div>
      )}
    </div>
  )
}

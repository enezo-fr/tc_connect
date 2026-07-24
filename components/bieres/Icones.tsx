'use client'

import {
  Sun, Cloud, CloudRain, CloudLightning, CloudSnow, CloudSun, Moon,
  ThermometerSnowflake, Thermometer, ThermometerSun,
} from 'lucide-react'

/**
 * Météo et ressenti : icônes propres à la place des emoji.
 *
 * ⚠️ Les VALEURS stockées restent les emoji d'origine (« ☀️ », « 🥶 ») : 184
 * dégustations importées les portent déjà, et les réécrire pour un choix
 * d'affichage serait une migration gratuite. On ne change que le rendu.
 */

const METEO = {
  '☀️': { Icone: Sun, libelle: 'Soleil', couleur: 'text-amber-500' },
  '🌦️': { Icone: CloudSun, libelle: 'Éclaircies', couleur: 'text-amber-400' },
  '☁️': { Icone: Cloud, libelle: 'Nuageux', couleur: 'text-gray-400' },
  '🌧️': { Icone: CloudRain, libelle: 'Pluie', couleur: 'text-sky-500' },
  '🌩️': { Icone: CloudLightning, libelle: 'Orage', couleur: 'text-violet-500' },
  '🌨️': { Icone: CloudSnow, libelle: 'Neige', couleur: 'text-sky-300' },
  '🌙': { Icone: Moon, libelle: 'Nuit', couleur: 'text-indigo-400' },
} as const

const RESSENTI = {
  '🥶': { Icone: ThermometerSnowflake, libelle: 'Il faisait froid', couleur: 'text-sky-500' },
  '😎': { Icone: Thermometer, libelle: 'Température idéale', couleur: 'text-emerald-500' },
  '🥵': { Icone: ThermometerSun, libelle: 'Il faisait très chaud', couleur: 'text-orange-500' },
} as const

export const meteoLibelle = (v?: string) => (v && v in METEO ? METEO[v as keyof typeof METEO].libelle : '')
export const ressentiLibelle = (v?: string) => (v && v in RESSENTI ? RESSENTI[v as keyof typeof RESSENTI].libelle : '')

export function IconeMeteo({ valeur, size = 14 }: { valeur?: string; size?: number }) {
  if (!valeur || !(valeur in METEO)) return null
  const { Icone, libelle, couleur } = METEO[valeur as keyof typeof METEO]
  return <Icone size={size} className={couleur} aria-label={libelle} />
}

export function IconeRessenti({ valeur, size = 14 }: { valeur?: string; size?: number }) {
  if (!valeur || !(valeur in RESSENTI)) return null
  const { Icone, libelle, couleur } = RESSENTI[valeur as keyof typeof RESSENTI]
  return <Icone size={size} className={couleur} aria-label={libelle} />
}

/** Pastille « icône + libellé », pour les listes de choix comme pour l'affichage */
export function PastilleMeteo({ valeur }: { valeur?: string }) {
  if (!valeur || !(valeur in METEO)) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">
      <IconeMeteo valeur={valeur} size={12} />{meteoLibelle(valeur)}
    </span>
  )
}

export function PastilleRessenti({ valeur }: { valeur?: string }) {
  if (!valeur || !(valeur in RESSENTI)) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">
      <IconeRessenti valeur={valeur} size={12} />{ressentiLibelle(valeur)}
    </span>
  )
}

/** Boutons de choix : l'icône porte le sens, le libellé lève toute ambiguïté */
export function ChoixIcones({ options, valeur, onChange, type }: {
  options: readonly string[]
  valeur: string
  onChange: (v: string) => void
  type: 'meteo' | 'ressenti'
}) {
  const table: Record<string, { Icone: React.ElementType; libelle: string; couleur: string }> =
    type === 'meteo' ? METEO : RESSENTI
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const def = table[o]
        if (!def) return null
        const { Icone, libelle } = def
        const actif = valeur === o
        return (
          <button key={o} type="button" onClick={() => onChange(actif ? '' : o)} title={libelle}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm border transition ${
              actif ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-700 hover:border-amber-300'
            }`}>
            <Icone size={15} className={actif ? 'text-white' : def.couleur} />
            {libelle}
          </button>
        )
      })}
    </div>
  )
}

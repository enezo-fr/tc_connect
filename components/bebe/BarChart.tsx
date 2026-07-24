'use client'

/**
 * Histogramme jour par jour, empilable — SVG à la main, comme `GrowthChart`
 * (aucune librairie de graphiques dans le projet, et 7 à 30 barres n'en
 * justifient pas une).
 *
 * Le viewBox est fixe et le SVG s'étire en largeur : les proportions et la
 * taille du texte restent stables du mobile au grand écran.
 */

export interface BarPoint {
  /** Libellé de l'axe (ex. « 12/07 ») */
  label: string
  /** Une valeur par segment empilé, dans l'ordre de `couleurs` */
  valeurs: number[]
}

interface Props {
  points: BarPoint[]
  /** Une couleur CSS par segment */
  couleurs: string[]
  /** Mise en forme des valeurs de l'axe vertical (ex. minutes → « 3 h ») */
  format?: (v: number) => string
  /** Légende : un libellé par segment */
  legendes?: string[]
}

const W = 320, H = 140
const PAD = { top: 10, right: 6, bottom: 20, left: 30 }

export function BarChart({ points, couleurs, format, legendes }: Props) {
  const fmt = format ?? ((v: number) => String(Math.round(v)))

  if (points.length === 0) {
    return <p className="text-sm text-gray-400 italic py-6 text-center">Aucune donnée.</p>
  }

  const totaux = points.map(p => p.valeurs.reduce((s, v) => s + v, 0))
  // Échelle basée sur le plus haut total ; jamais 0, sinon division par zéro
  const yMax = Math.max(...totaux, 1)

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const pas = innerW / points.length
  // Barres fines mais visibles, avec un filet d'air entre elles
  const largeur = Math.max(2, Math.min(22, pas * 0.7))
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  // Au-delà de ~8 barres les dates se chevauchent : on n'en montre qu'une sur n
  const sautLabel = Math.ceil(points.length / 7)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        {[yMax, yMax / 2, 0].map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{fmt(v)}</text>
          </g>
        ))}

        {points.map((p, i) => {
          const cx = PAD.left + pas * i + pas / 2
          let bas = y(0)
          return (
            <g key={i}>
              {p.valeurs.map((v, s) => {
                if (v <= 0) return null
                const haut = bas - (v / yMax) * innerH
                const rect = (
                  <rect key={s} x={cx - largeur / 2} y={haut} width={largeur} height={bas - haut}
                    fill={couleurs[s] ?? couleurs[couleurs.length - 1]} rx={1.5} />
                )
                bas = haut
                return rect
              })}
              {i % sautLabel === 0 && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={7.5} fill="#94a3b8">{p.label}</text>
              )}
            </g>
          )
        })}
      </svg>

      {legendes && legendes.length > 1 && (
        <div className="flex flex-wrap gap-3 justify-center mt-1">
          {legendes.map((l, i) => (
            <span key={i} className="flex items-center gap-1 text-[11px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: couleurs[i] }} />
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

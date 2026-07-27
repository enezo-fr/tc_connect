'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { FORMATS_BOISSON, composerBoisson } from '@/lib/commandeModel'
import { LA_TABLE } from '@/lib/commandeMoi'
import { Plus, Minus } from 'lucide-react'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

export interface BoissonAjout {
  boisson: string
  quantite: number
  prix?: number
  /** Contenance choisie — remontée pour la mémoriser par défaut sur la commande. */
  format: string
  /** Destinataire choisi dans la modale ; `null` = « La table ». */
  pour: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Destinataire présélectionné (carte touchée, ou « moi ») ; null = « La table ». */
  pour: string | null
  /** Personnes présentes — le destinataire se change dans la modale. */
  participants: string[]
  /** Boissons déjà commandées (noms complets, sans re-préfixer de format). */
  boissonsConnues: string[]
  /** Contenance présélectionnée (mémorisée de la dernière saisie). */
  formatDefaut: string
  /** Dernier prix connu pour un nom de boisson complet. */
  prixConnu: (boisson: string) => number | null
  /** Édition d'une ligne existante (pré-remplissage) ; absent = ajout. */
  initial?: { boisson: string; prix?: number; quantite: number; pour?: string | null } | null
  onAdd: (b: BoissonAjout) => void
}

/**
 * Ajout d'une boisson : on choisit d'abord la CONTENANCE (Pinte, Demi…), puis le
 * nom — le format se colle devant. La contenance par défaut est mémorisée pour
 * enchaîner vite quand toute la tablée est au même format.
 */
export function AjoutBoissonModal({ isOpen, onClose, pour, participants, boissonsConnues, formatDefaut, prixConnu, initial = null, onAdd }: Props) {
  const [format, setFormat] = useState('')
  const [nom, setNom] = useState('')
  const [prix, setPrix] = useState('')
  const [quantite, setQuantite] = useState(1)
  // Destinataire : '' = La table. Modifiable ici, pour ne pas avoir à ressortir
  // de la modale quand on commande pour le voisin.
  const [pourSel, setPourSel] = useState('')

  useEffect(() => {
    if (!isOpen) return
    if (initial) {
      // Édition : le nom complet (déjà « Pinte blonde ») va dans le champ, contenance à part.
      setFormat(''); setNom(initial.boisson)
      setPrix(initial.prix != null ? String(initial.prix) : '')
      setQuantite(Math.max(1, initial.quantite))
      setPourSel(initial.pour ?? '')
    } else {
      setFormat(formatDefaut || ''); setNom(''); setPrix(''); setQuantite(1)
      setPourSel(pour && pour !== LA_TABLE ? pour : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Nom d'une boisson SANS sa contenance de tête (« Pinte blonde » → « blonde »),
  // pour ne pas répéter la contenance dans les suggestions.
  const sansFormat = (s: string): string => {
    const t = s.trim()
    const m = t.match(/^(\S+)\s+(.+)$/)
    if (m && FORMATS_BOISSON.some((f) => f.toLowerCase() === m[1].toLowerCase())) return m[2]
    return t
  }
  const bases = Array.from(new Set(boissonsConnues.map(sansFormat).filter(Boolean)))

  // Choisir une boisson connue : on GARDE la contenance sélectionnée, on ne met que le nom.
  const choisir = (base: string) => {
    setNom(base)
    const p = prixConnu(composerBoisson(format, base))
    if (p != null) setPrix(String(p))
  }

  const q = nom.trim().toLowerCase()
  const auto = q ? bases.filter((b) => b.toLowerCase().includes(q) && b.toLowerCase() !== q).slice(0, 6) : []

  const apercu = composerBoisson(format, nom)

  const valider = () => {
    if (!apercu.trim()) return
    const p = prixConnu(apercu)
    onAdd({
      boisson: apercu,
      quantite: Math.max(1, quantite),
      prix: prix ? Number(prix.replace(',', '.')) : (p ?? undefined),
      format,
      pour: pourSel || null,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? 'Modifier la boisson' : 'Ajouter une boisson'}>
      <div className="space-y-4">
        {/* Pour qui — pré-sélectionné (moi, ou la carte touchée), changeable ici */}
        {participants.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Pour qui ?</label>
            <div className="flex flex-wrap gap-1.5">
              {[{ v: '', l: LA_TABLE }, ...participants.map((p) => ({ v: p, l: p }))].map((o) => (
                <button key={o.v || '__table'} type="button" onClick={() => setPourSel(o.v)}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition ${pourSel === o.v ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Contenance d'abord */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Contenance</label>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS_BOISSON.map((f) => (
              <button key={f} type="button" onClick={() => setFormat((cur) => (cur === f ? '' : f))}
                className={`px-3 py-1.5 rounded-xl text-sm border transition ${format === f ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'}`}>
                {f}
              </button>
            ))}
          </div>
          <input value={format} onChange={(e) => setFormat(e.target.value)}
            placeholder="ou autre (Pichet, Magnum…)"
            className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>

        {/* Puis le nom */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {format ? `${format}…` : 'Boisson'}
          </label>
          <input value={nom} onChange={(e) => setNom(e.target.value)}
            placeholder={format ? 'blonde, IPA, blanche…' : 'Coca, Café, blonde…'} className={champCls} autoFocus />
          {auto.length > 0 && (
            <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-50 overflow-hidden">
              {auto.map((b) => (
                <button key={b} type="button" onClick={() => choisir(b)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-sky-50 transition">
                  {b}
                </button>
              ))}
            </div>
          )}
          {format && nom.trim() && (
            <p className="text-xs text-gray-400 mt-1">→ {apercu}</p>
          )}
        </div>

        {/* Déjà commandées : le nom seul (la contenance se choisit au-dessus) */}
        {bases.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Déjà commandées</p>
            <div className="flex flex-wrap gap-1.5">
              {bases.map((b) => (
                <button key={b} type="button" onClick={() => choisir(b)}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition ${nom.trim().toLowerCase() === b.toLowerCase() ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQuantite((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center justify-center">
                <Minus size={15} />
              </button>
              <span className="w-8 text-center text-base font-semibold">{quantite}</span>
              <button type="button" onClick={() => setQuantite((q) => q + 1)}
                className="w-9 h-9 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center justify-center">
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prix unitaire <span className="text-gray-400">(facultatif)</span>
            </label>
            <input type="text" inputMode="decimal" value={prix}
              onChange={(e) => setPrix(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="6,50" className={champCls} />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
          <button onClick={valider} disabled={!apercu.trim()}
            className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
            {initial ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { FORMATS_BOISSON, composerBoisson } from '@/lib/commandeModel'
import { Plus, Minus } from 'lucide-react'

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

export interface BoissonAjout {
  boisson: string
  quantite: number
  prix?: number
  /** Contenance choisie — remontée pour la mémoriser par défaut sur la commande. */
  format: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Pour qui (titre de la modale). */
  pour: string | null
  /** Boissons déjà commandées (noms complets, sans re-préfixer de format). */
  boissonsConnues: string[]
  /** Contenance présélectionnée (mémorisée de la dernière saisie). */
  formatDefaut: string
  /** Dernier prix connu pour un nom de boisson complet. */
  prixConnu: (boisson: string) => number | null
  onAdd: (b: BoissonAjout) => void
}

/**
 * Ajout d'une boisson : on choisit d'abord la CONTENANCE (Pinte, Demi…), puis le
 * nom — le format se colle devant. La contenance par défaut est mémorisée pour
 * enchaîner vite quand toute la tablée est au même format.
 */
export function AjoutBoissonModal({ isOpen, onClose, pour, boissonsConnues, formatDefaut, prixConnu, onAdd }: Props) {
  const [format, setFormat] = useState('')
  const [nom, setNom] = useState('')
  const [prix, setPrix] = useState('')
  const [quantite, setQuantite] = useState(1)

  useEffect(() => {
    if (!isOpen) return
    setFormat(formatDefaut || '')
    setNom(''); setPrix(''); setQuantite(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Une suggestion est un nom COMPLET (« Pinte blonde ») : on l'utilise tel quel,
  // sans re-préfixer de contenance.
  const choisirSuggestion = (b: string) => {
    setFormat('')
    setNom(b)
    const p = prixConnu(b)
    if (p != null) setPrix(String(p))
  }

  const apercu = composerBoisson(format, nom)

  const valider = () => {
    if (!apercu.trim()) return
    const p = prixConnu(apercu)
    onAdd({
      boisson: apercu,
      quantite: Math.max(1, quantite),
      prix: prix ? Number(prix.replace(',', '.')) : (p ?? undefined),
      format,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={pour ? `Pour ${pour}` : 'Ajouter une boisson'}>
      <div className="space-y-4">
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
        </div>

        {/* Puis le nom */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {format ? `${format}…` : 'Boisson'}
          </label>
          <input value={nom} onChange={(e) => setNom(e.target.value)}
            placeholder={format ? 'blonde, IPA, blanche…' : 'Coca, Café, Pinte blonde…'} className={champCls} autoFocus />
          {format && nom.trim() && (
            <p className="text-xs text-gray-400 mt-1">→ {apercu}</p>
          )}
        </div>

        {/* Déjà commandées : nom complet, en un clic */}
        {boissonsConnues.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Déjà commandées</p>
            <div className="flex flex-wrap gap-1.5">
              {boissonsConnues.map((b) => (
                <button key={b} type="button" onClick={() => choisirSuggestion(b)}
                  className={`px-3 py-1.5 rounded-xl text-sm border transition ${apercu === b ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'}`}>
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
            Ajouter
          </button>
        </div>
      </div>
    </Modal>
  )
}

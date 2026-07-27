'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Plus, UserRound } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Personnes déjà à la tournée. */
  participants: string[]
  /** Identité actuelle de cet appareil (null = personne). */
  moi: string | null
  onChoisir: (nom: string | null) => void
  /** Ajoute quelqu'un à la tournée (invité absent de la liste). Absent = pas d'ajout possible. */
  onAjouterPersonne?: (nom: string) => void | Promise<void>
  /** Première venue : on veut une réponse, pas de bouton « Annuler ». */
  premiere?: boolean
}

/**
 * « Qui êtes-vous ? » — choisi une fois par appareil et par commande, puis retenu
 * (cf. `lib/commandeMoi.ts`). Chacun désigne son prénom dans la tablée : ses
 * boissons sont dès lors pré-affectées, sans repasser par la carte de quelqu'un.
 */
export function MoiPicker({ isOpen, onClose, participants, moi, onChoisir, onAjouterPersonne, premiere = false }: Props) {
  const [saisie, setSaisie] = useState('')
  const [ajout, setAjout] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setSaisie(''); setAjout(false)
  }, [isOpen])

  const ajouter = async () => {
    const n = saisie.trim()
    if (!n) return
    // Déjà dans la liste (à la casse près) → on se contente de le sélectionner.
    const existant = participants.find((p) => p.trim().toLowerCase() === n.toLowerCase())
    if (!existant && onAjouterPersonne) await onAjouterPersonne(n)
    onChoisir(existant ?? n)
    onClose()
  }

  const choisir = (nom: string | null) => { onChoisir(nom); onClose() }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Qui êtes-vous ?">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Choisissez votre prénom : vos boissons seront ajoutées pour vous, sans avoir à le
          redire à chaque fois. Vous pourrez toujours commander pour quelqu&apos;un d&apos;autre.
        </p>

        {participants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {participants.map((p) => (
              <button key={p} type="button" onClick={() => choisir(p)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${
                  moi === p ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-200 text-gray-700 hover:border-sky-300'
                }`}>
                <UserRound size={14} />{p}
              </button>
            ))}
          </div>
        )}

        {onAjouterPersonne && (ajout ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={saisie} onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && saisie.trim()) { e.preventDefault(); ajouter() } }}
              placeholder="Votre prénom"
              className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <button type="button" onClick={ajouter} disabled={!saisie.trim()}
              className="px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-40 transition shrink-0">
              Rejoindre
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAjout(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-700 transition">
            <Plus size={15} />Je ne suis pas dans la liste
          </button>
        ))}

        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <button onClick={() => choisir(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            Je ne commande pas
          </button>
          {!premiere && (
            <button onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
              Annuler
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

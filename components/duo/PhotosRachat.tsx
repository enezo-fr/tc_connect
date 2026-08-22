'use client'

import { useRef, useState } from 'react'
import { uploadImage } from '@/lib/uploadImage'
import { ImagePlus, Loader2, Trash2, Check, X } from 'lucide-react'

/**
 * Les photos d'une fiche « à racheter » — l'étiquette d'une bouteille vaut mieux
 * qu'un formulaire complet, et il en faut souvent deux (l'étiquette et le dos).
 *
 * Reprend la grille photo de l'app Bières : vignettes, badge « 1ʳᵉ » sur celle
 * qui illustrera la liste, et flèches pour réordonner (le glisser-déposer est
 * peu fiable au doigt). Seule différence, imposée par la règle maison : on
 * supprime avec une POUBELLE et une confirmation, pas avec une croix.
 *
 * 🔑 L'envoi est IMMÉDIAT (dès le choix du fichier), pas à l'enregistrement :
 * sur un téléphone, l'aperçu doit apparaître tout de suite. Conséquence, une
 * photo envoyée puis abandonnée (« Annuler ») resterait orpheline dans le
 * Storage — d'où `onOrphelin`, qui laisse le formulaire retenir ce qu'il devra
 * effacer s'il est annulé. C'est exactement le piège rencontré sur les exercices.
 *
 * ⚠️ Chemin `users/{uid}/rachats/` : les règles Storage n'ouvrent l'écriture que
 * sur les chemins déclarés, et un chemin inconnu est refusé EN SILENCE. La
 * lecture y est publique, donc le conjoint voit bien les photos ; en revanche
 * seul celui qui a envoyé un fichier peut l'effacer du Storage.
 */
export default function PhotosRachat({ photos, uid, onChange, onOrphelin }: {
  photos: string[]
  uid: string
  onChange: (photos: string[]) => void
  /** Prévient le formulaire qu'un fichier vient d'être envoyé (à effacer si on annule). */
  onOrphelin?: (url: string) => void
}) {
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [aRetirer, setARetirer] = useState<string | null>(null)
  const champ = useRef<HTMLInputElement>(null)

  const ajouter = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return
    setEnvoi(true); setErreur('')
    try {
      const urls: string[] = []
      for (const f of Array.from(fichiers).slice(0, 6)) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 10 * 1024 * 1024) { setErreur('Photo trop lourde (10 Mo maximum).'); continue }
        const url = await uploadImage(f, `users/${uid}/rachats/${Date.now()}_${f.name}`)
        urls.push(url)
        onOrphelin?.(url)
      }
      if (urls.length) onChange([...photos, ...urls])
    } catch {
      setErreur("L'envoi a échoué — réessayez.")
    } finally {
      setEnvoi(false)
      if (champ.current) champ.current.value = ''   // re-choisir le même fichier reste possible
    }
  }

  const deplacer = (i: number, sens: -1 | 1) => {
    const c = [...photos]
    const j = i + sens
    if (j < 0 || j >= c.length) return
    ;[c[i], c[j]] = [c[j], c[i]]
    onChange(c)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={url} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" />

            {i === 0 && photos.length > 1 && (
              <span className="absolute top-1 left-1 bg-rose-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                1ʳᵉ
              </span>
            )}

            {/* Confirmation EN LIGNE : une seconde modale par-dessus le formulaire
                se disputerait le verrou de défilement de la page. */}
            {aRetirer === url ? (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-1.5">
                <button type="button" aria-label="Confirmer le retrait"
                  onClick={() => { onChange(photos.filter((p) => p !== url)); setARetirer(null) }}
                  className="w-7 h-7 rounded-lg bg-red-500 text-white flex items-center justify-center">
                  <Check size={15} />
                </button>
                <button type="button" aria-label="Annuler le retrait" onClick={() => setARetirer(null)}
                  className="w-7 h-7 rounded-lg bg-white/90 text-gray-700 flex items-center justify-center">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <>
                <button type="button" aria-label="Retirer cette photo" onClick={() => setARetirer(url)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-lg bg-white/90 text-gray-500 hover:text-red-600 flex items-center justify-center shadow-sm transition">
                  <Trash2 size={13} />
                </button>
                {photos.length > 1 && (
                  <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                    <button type="button" aria-label="Reculer la photo" disabled={i === 0}
                      onClick={() => deplacer(i, -1)}
                      className="w-5 h-5 rounded-full bg-white/90 text-gray-600 text-xs leading-none shadow disabled:opacity-0">
                      ‹
                    </button>
                    <button type="button" aria-label="Avancer la photo" disabled={i === photos.length - 1}
                      onClick={() => deplacer(i, 1)}
                      className="w-5 h-5 rounded-full bg-white/90 text-gray-600 text-xs leading-none shadow disabled:opacity-0">
                      ›
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        <button type="button" onClick={() => champ.current?.click()} disabled={envoi}
          className="w-20 h-20 rounded-xl border border-dashed border-gray-300 text-gray-400 hover:border-rose-300 hover:text-rose-600 flex flex-col items-center justify-center gap-1 transition disabled:opacity-60">
          {envoi ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          <span className="text-[10px]">{envoi ? 'Envoi…' : 'Photo'}</span>
        </button>
      </div>

      <input ref={champ} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => ajouter(e.target.files)} />

      {erreur && <p className="text-xs text-amber-600">{erreur}</p>}
      {photos.length > 1 && (
        <p className="text-[11px] text-gray-400">La première photo illustre la fiche dans la liste.</p>
      )}
    </div>
  )
}

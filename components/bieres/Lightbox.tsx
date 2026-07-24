'use client'

import { useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Visionneuse plein écran.
 *
 * Volontairement hors du composant `Modal` maison : celui-ci contraint la
 * largeur et ajoute des marges, alors qu'une photo doit occuper l'écran.
 * Fermeture au clic sur le fond, à la croix ou avec Échap ; flèches du clavier
 * pour naviguer, comme dans n'importe quelle galerie.
 */
export default function Lightbox({ photos, index, onClose, onIndex }: {
  photos: string[]
  index: number
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const precedent = useCallback(
    () => onIndex((index - 1 + photos.length) % photos.length),
    [index, photos.length, onIndex],
  )
  const suivant = useCallback(
    () => onIndex((index + 1) % photos.length),
    [index, photos.length, onIndex],
  )

  useEffect(() => {
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') precedent()
      if (e.key === 'ArrowRight') suivant()
    }
    window.addEventListener('keydown', clavier)
    // Le fond ne doit pas défiler derrière la photo
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', clavier)
      document.body.style.overflow = overflow
    }
  }, [onClose, precedent, suivant])

  if (!photos.length) return null

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button onClick={onClose} title="Fermer"
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
        <X size={20} />
      </button>

      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); precedent() }}
            className="absolute left-2 sm:left-4 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); suivant() }}
            className="absolute right-2 sm:right-4 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
            <ChevronRight size={24} />
          </button>
          <span className="absolute bottom-4 text-xs text-white/70">
            {index + 1} / {photos.length}
          </span>
        </>
      )}

      {/* Le clic sur l'image ne ferme pas : seul le fond ferme */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[index]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[94vw] object-contain rounded-lg"
      />
    </div>
  )
}

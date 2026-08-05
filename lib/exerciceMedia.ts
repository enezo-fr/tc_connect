/**
 * Photos et vidéos d'exercice PARTAGÉES entre plusieurs exercices.
 *
 * Principe : quand un exercice « reprend » le média d'un autre, on enregistre sur lui
 * l'URL du fichier (donc tous les écrans qui affichent une photo/vidéo continuent de
 * marcher sans rien connaître du partage) ET l'identifiant de l'exercice source
 * (`image_source_id` / `video_source_id`), qui sert à deux choses :
 *   1. ne JAMAIS supprimer du Storage un fichier encore utilisé ailleurs ;
 *   2. répercuter le changement sur les exercices qui reprennent le média quand la
 *      source change sa photo ou sa vidéo.
 *
 * Un seul fichier est stocké, quel que soit le nombre d'exercices qui l'affichent.
 */

import type { Exercice } from '@/types'
import { deleteImage } from '@/lib/uploadImage'

export type TypeMedia = 'image' | 'video'

export const TYPES_MEDIA: TypeMedia[] = ['image', 'video']

export const CHAMP_URL = { image: 'image_exercice', video: 'video_exercice' } as const
export const CHAMP_SOURCE = { image: 'image_source_id', video: 'video_source_id' } as const

type ExerciceLike = Partial<Exercice> & { id?: string }

export function urlMedia(ex: ExerciceLike | null | undefined, type: TypeMedia): string {
  return ((ex as Record<string, unknown> | null | undefined)?.[CHAMP_URL[type]] as string) || ''
}

export function sourceMedia(ex: ExerciceLike | null | undefined, type: TypeMedia): string {
  return ((ex as Record<string, unknown> | null | undefined)?.[CHAMP_SOURCE[type]] as string) || ''
}

export const LIBELLE_MEDIA: Record<TypeMedia, string> = { image: 'photo', video: 'vidéo' }

/** Tous les exercices qui affichent ce type de média (référence ET reprises), sauf celui en cours. */
export function exercicesAvecMedia(tous: Exercice[], type: TypeMedia, exclureId?: string): Exercice[] {
  return tous.filter((e) => e.id !== exclureId && !!urlMedia(e, type))
}

/**
 * Les exercices de RÉFÉRENCE : ceux qui possèdent vraiment le fichier, sans le reprendre
 * de personne. Ce sont les seuls qu'on propose de reprendre — reprendre une reprise
 * n'aurait aucun sens et le lien pointerait de toute façon sur la référence.
 */
export function exercicesReference(tous: Exercice[], type: TypeMedia, exclureId?: string): Exercice[] {
  return tous.filter((e) => e.id !== exclureId && !!urlMedia(e, type) && !sourceMedia(e, type))
}

/**
 * Remonte jusqu'à l'exercice qui possède vraiment le fichier : reprendre le média d'un
 * exercice qui le reprenait lui-même d'un troisième pointe directement sur le troisième
 * (pas de chaîne à maintenir). Garde-fou anti-boucle.
 */
export function racineMedia(exId: string, type: TypeMedia, tous: Exercice[]): string {
  let courant = tous.find((e) => e.id === exId)
  const vus = new Set<string>()
  while (courant && sourceMedia(courant, type) && !vus.has(courant.id)) {
    vus.add(courant.id)
    const parent = tous.find((e) => e.id === sourceMedia(courant!, type))
    if (!parent || !urlMedia(parent, type)) break
    courant = parent
  }
  return courant?.id ?? exId
}

/** Un autre exercice affiche-t-il encore ce fichier ? */
export function mediaEncoreUtilise(url: string, tous: Exercice[], ignorer: string[]): boolean {
  if (!url) return false
  return tous.some(
    (e) => !ignorer.includes(e.id) && TYPES_MEDIA.some((t) => urlMedia(e, t) === url),
  )
}

/** Supprime le fichier du Storage UNIQUEMENT si plus personne ne s'en sert. */
export async function supprimerMediaSiOrphelin(url: string, tous: Exercice[], ignorer: string[]): Promise<void> {
  if (!url) return
  if (mediaEncoreUtilise(url, tous, ignorer)) return
  await deleteImage(url)
}

type MajExercice = (id: string, data: Record<string, unknown>) => Promise<void>

/** Les exercices qui reprennent le média de `id`. */
export function repreneurs(id: string, type: TypeMedia, tous: Exercice[]): Exercice[] {
  return tous.filter((e) => e.id !== id && sourceMedia(e, type) === id)
}

/**
 * À appeler après avoir enregistré un exercice : répercute sur ceux qui reprennent son
 * média, puis supprime l'ancien fichier s'il n'est plus utilisé nulle part.
 * `tous` = la liste telle qu'elle était avant l'enregistrement.
 */
export async function synchroniserMedias(
  id: string,
  avant: ExerciceLike,
  apres: ExerciceLike,
  tous: Exercice[],
  updateExercice: MajExercice,
): Promise<void> {
  for (const type of TYPES_MEDIA) {
    const ancienne = urlMedia(avant, type)
    const nouvelle = urlMedia(apres, type)
    if (ancienne === nouvelle) continue

    const suiveurs = repreneurs(id, type, tous)
    await Promise.all(
      suiveurs.map((e) =>
        updateExercice(
          e.id,
          nouvelle
            ? { [CHAMP_URL[type]]: nouvelle }
            : { [CHAMP_URL[type]]: '', [CHAMP_SOURCE[type]]: '' },
        ),
      ),
    )

    await supprimerMediaSiOrphelin(ancienne, tous, [id, ...suiveurs.map((e) => e.id)])
  }
}

/**
 * Suppression d'un exercice : ceux qui reprenaient ses médias en deviennent propriétaires
 * (ils gardent l'URL, on efface juste le lien vers la source) — le fichier n'est effacé
 * du Storage que si plus aucun exercice ne l'affiche.
 */
export async function supprimerExerciceEtMedias(
  ex: Exercice,
  tous: Exercice[],
  deleteExercice: (id: string) => Promise<void>,
  updateExercice: MajExercice,
): Promise<void> {
  for (const type of TYPES_MEDIA) {
    const suiveurs = repreneurs(ex.id, type, tous)
    await Promise.all(suiveurs.map((e) => updateExercice(e.id, { [CHAMP_SOURCE[type]]: '' })))
  }
  await deleteExercice(ex.id)
  for (const type of TYPES_MEDIA) {
    await supprimerMediaSiOrphelin(urlMedia(ex, type), tous, [ex.id])
  }
}

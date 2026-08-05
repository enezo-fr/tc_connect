/**
 * Récupérer une photo ou une vidéo d'exercice SUR SON APPAREIL.
 *
 * On ne peut pas se contenter d'un `<a href={url} download>` : l'attribut `download`
 * est ignoré sur une URL d'un autre domaine (le Storage Firebase en est un), le
 * navigateur se contente d'ouvrir le fichier. Il faut donc le rapatrier en `blob`
 * puis fabriquer un lien `blob:` (même origine, `download` respecté).
 *
 * Les URL `firebasestorage.googleapis.com/v0/…?alt=media` répondent avec
 * `Access-Control-Allow-Origin: *` — vérifié le 2026-08-05 — donc `fetch` passe sans
 * avoir à configurer le CORS du bucket.
 */

/** Nom de fichier lisible et sans caractère interdit, extension déduite du type réel. */
export function nomFichierMedia(nomExercice: string, typeMime: string, urlSecours = ''): string {
  const base = (nomExercice || 'exercice')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')   // sans accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'exercice'
  const depuisMime = typeMime.split('/')[1]?.split(';')[0]
  const depuisUrl = urlSecours.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/)?.[1]
  const ext = (depuisMime === 'quicktime' ? 'mov' : depuisMime) || depuisUrl || 'bin'
  return `${base}.${ext}`
}

/** Rapatrie le fichier en mémoire — sert au téléchargement ET au partage natif. */
export async function fichierDepuisUrl(url: string, nomExercice: string): Promise<File | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const type = blob.type || 'application/octet-stream'
    return new File([blob], nomFichierMedia(nomExercice, type, url), { type })
  } catch {
    return null
  }
}

/** Déclenche l'enregistrement d'un fichier déjà en mémoire. */
export function enregistrerFichier(fichier: File): void {
  const lien = document.createElement('a')
  lien.href = URL.createObjectURL(fichier)
  lien.download = fichier.name
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  // Laisse au navigateur le temps de lire le blob avant de le libérer.
  setTimeout(() => URL.revokeObjectURL(lien.href), 60_000)
}

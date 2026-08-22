'use client'

import type { Coords } from '@/lib/geoloc'

/**
 * Côté navigateur du géocodage : on ne parle jamais à Nominatim directement,
 * toujours à notre route `/api/geocodage` (cf. le commentaire qui y est).
 */

export interface LieuTrouve {
  label: string
  adresse: string
  ville: string
  codePostal: string
  pays: string
  lat: number
  lng: number
}

async function appel(params: Record<string, string>): Promise<LieuTrouve[]> {
  try {
    const url = new URL('/api/geocodage', window.location.origin)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url)
    const data = await res.json()
    return Array.isArray(data?.lieux) ? data.lieux : []
  } catch {
    return []
  }
}

/** Propositions pour une adresse tapée (vide si le service ne répond pas). */
export const chercherLieu = (q: string) => appel({ q })

/** Adresse d'un point GPS, ou `null` si elle est introuvable. */
export async function adresseDeCoords(c: Coords): Promise<LieuTrouve | null> {
  const lieux = await appel({ lat: String(c.lat), lng: String(c.lng) })
  return lieux[0] ?? null
}

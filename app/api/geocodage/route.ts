import { NextResponse } from 'next/server'

/**
 * Géocodage aller-retour : une adresse → des coordonnées, des coordonnées → une
 * adresse. Utilisé par l'app « Sarah & Ted » (activités) pour que l'un remplisse
 * l'autre, quel que soit le bout par lequel on commence.
 *
 * Fournisseur : **Nominatim / OpenStreetMap**, sans clé ni compte.
 *  - Choisi plutôt que la Base Adresse Nationale parce que la BAN s'arrête aux
 *    frontières françaises, et qu'il y a des lieux étrangers dans la liste
 *    (la Dent de Jaman est en Suisse).
 *  - ⚠️ L'appel passe par le SERVEUR, jamais par le navigateur : Nominatim exige
 *    un `User-Agent` identifiant l'application, qu'un fetch de navigateur ne
 *    peut pas fixer. Ça évite aussi tout souci de CORS.
 *  - Politique d'usage : au plus une requête par seconde. La saisie est donc
 *    temporisée côté champ, et les réponses sont mises en cache 24 h.
 *
 * `GET ?q=...`            → jusqu'à 5 propositions
 * `GET ?lat=..&lng=..`    → l'adresse du point (une seule réponse)
 */

const UA = 'tc-connect/1.0 (contact@enezo.fr)'

interface LieuTrouve {
  label: string
  /** Ligne d'adresse, sans le pays ni le code postal. */
  adresse: string
  ville: string
  codePostal: string
  pays: string
  lat: number
  lng: number
}

type Adresse = Record<string, string | undefined>

/** Nominatim éclate l'adresse en une dizaine de clés selon le type de lieu. */
function versLieu(d: {
  display_name?: string; lat?: string; lon?: string; address?: Adresse; name?: string
}): LieuTrouve | null {
  const lat = Number(d.lat)
  const lng = Number(d.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const a = d.address ?? {}
  const ville = a.city || a.town || a.village || a.municipality || a.hamlet || ''
  const voie = [a.house_number, a.road].filter(Boolean).join(' ')
  // Le NOM du lieu passe devant la voie : « 1930 Conleau, Allée Pierre et Paul
  // Cadoret, Vannes » se reconnaît, « Allée Pierre et Paul Cadoret » non. Le
  // `display_name` complet, lui, empile une dizaine de niveaux administratifs.
  const nom = d.name || a.amenity || a.tourism || a.shop || a.leisure || a.natural || ''
  const adresse = [nom, voie, ville]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ')

  return {
    label: d.display_name ?? adresse,
    adresse: adresse || (d.display_name ?? ''),
    ville,
    codePostal: a.postcode ?? '',
    pays: a.country ?? '',
    lat,
    lng,
  }
}

async function appelNominatim(chemin: string, params: Record<string, string>) {
  const url = new URL(`https://nominatim.openstreetmap.org/${chemin}`)
  Object.entries({ format: 'jsonv2', addressdetails: '1', ...params })
    .forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr' },
    // Les adresses ne bougent pas : un cache d'une journée suffit à rester très
    // en dessous des limites d'usage, même en tapant beaucoup.
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  return res.json()
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const q = (p.get('q') ?? '').trim()
  const lat = p.get('lat')
  const lng = p.get('lng')

  try {
    if (lat && lng) {
      const d = await appelNominatim('reverse', { lat, lon: lng, zoom: '18' })
      const lieu = versLieu(d ?? {})
      return NextResponse.json({ lieux: lieu ? [lieu] : [] })
    }

    if (q.length < 3) return NextResponse.json({ lieux: [] })

    const liste = await appelNominatim('search', { q, limit: '5' })
    const lieux = (Array.isArray(liste) ? liste : []).map(versLieu).filter(Boolean)
    return NextResponse.json({ lieux })
  } catch (e) {
    console.error('[geocodage]', e)
    // Une panne du service ne doit jamais bloquer la saisie : le champ reste
    // libre, l'utilisateur tape ce qu'il veut.
    return NextResponse.json({ lieux: [], erreur: 'Service indisponible.' }, { status: 200 })
  }
}

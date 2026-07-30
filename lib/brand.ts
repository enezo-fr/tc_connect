// lib/brand.ts
// Configuration centralisée des deux marques de l'app (« une app, deux portes »).
// Source UNIQUE de vérité pour la marque : lue par le contexte de marque (context/BrandContext.tsx)
// et, plus tard (Phase 2), par le thème (couleurs / logo / nom).
// Phase 0 : rien de visuel n'est encore branché — on ne fait que définir et résoudre la marque.

export type Brand = 'coaching' | 'enezo'

export interface BrandConfig {
  id: Brand
  /** Nom affiché côté client (remplace « TC Connect » à terme, avec feu vert). */
  nom: string
  /** Couleur principale (hex). */
  couleurPrimaire: string
  /** Variante foncée éventuelle. */
  couleurPrimaireDark?: string
  /** Accent rare éventuel. */
  accent?: string
  /** Chemin du logo dans /public. */
  logo: string
  /** Hosts qui ouvrent cette marque (sans port). */
  domaines: string[]
  /**
   * Origine PUBLIQUE canonique (scheme + host) des liens qui sortent de l'app vers un
   * client/prospect. Distincte de `domaines` : `domaines` sert à reconnaître un host
   * entrant (routage/thème), `origine` sert à FABRIQUER un lien sortant.
   * Doit toujours pointer sur un domaine VIVANT (cf. publicLinkOrigin).
   */
  origine: string
}

export const BRANDS: Record<Brand, BrandConfig> = {
  coaching: {
    id: 'coaching',
    // Primaire RÉEL de l'app = gris Flutter #737374 (la famille `blue-*` est remappée dessus
    // dans globals.css). L'ancien '#2563eb' ne correspondait pas à l'écran.
    nom: 'Teddy Coaching',
    couleurPrimaire: '#737374',
    logo: '/logo.PNG',
    // ⚠️ `espace.teddycoaching.fr` est DÉCLARÉ mais pas encore branché (DNS mort au 30/07/2026) :
    // il reste ici pour le jour où il sera connecté, mais il ne doit JAMAIS servir à fabriquer
    // un lien sortant — c'est le rôle de `origine`.
    domaines: ['espace.teddycoaching.fr', 'tc-connect-two.vercel.app'],
    origine: 'https://tc-connect-two.vercel.app',
  },
  enezo: {
    id: 'enezo',
    nom: 'Enezo',
    couleurPrimaire: '#377684',      // Petrol
    couleurPrimaireDark: '#2B5E6A',  // Petrol foncé
    accent: '#D2A244',               // Or (accent rare)
    logo: '/logo-enezo.png',         // ⚠️ à fournir dans /public (logo Enezo)
    // L'APP tourne sur le sous-domaine `app.enezo.fr` (Vercel). `enezo.fr` seul =
    // site vitrine (autre hébergement), il ne touche jamais cette app.
    domaines: ['app.enezo.fr'],
    origine: 'https://app.enezo.fr',
  },
}

/** Marque par défaut : l'existant est coaching, on ne bascule jamais par accident vers Enezo. */
export const DEFAULT_BRAND: Brand = 'coaching'

/** Toutes les marques (ordre = ordre d'affichage). */
export const ALL_BRANDS: Brand[] = ['coaching', 'enezo']

const isBrand = (v: unknown): v is Brand => v === 'coaching' || v === 'enezo'

/**
 * Univers d'un profil (client ou compte), en repli sur le champ mono-univers déprécié `marque`.
 * Renvoie toujours au moins une marque (défaut coaching). L'élément [0] = univers principal / d'accueil.
 */
export function normalizeMarques(m: { marques?: unknown; marque?: unknown } | null | undefined): Brand[] {
  const list = Array.isArray(m?.marques) ? m!.marques.filter(isBrand) : []
  if (list.length) return Array.from(new Set(list))
  if (isBrand(m?.marque)) return [m!.marque as Brand]
  return [DEFAULT_BRAND]
}

/** Résout une marque depuis un host (nom de domaine). Renvoie null si aucun match. */
export function hostToBrand(host: string | null | undefined): Brand | null {
  if (!host) return null
  const h = host.toLowerCase().split(':')[0] // retire le port éventuel
  for (const b of Object.values(BRANDS)) {
    if (b.domaines.some((d) => h === d || h.endsWith('.' + d))) return b.id
  }
  // Repli heuristique (previews Vercel, sous-domaines temporaires) : mot-clé dans le host.
  if (h.includes('enezo')) return 'enezo'
  if (h.includes('teddycoaching')) return 'coaching'
  return null
}

/** Config d'une marque, avec repli sur la marque par défaut. */
export function brandConfig(brand: Brand | undefined | null): BrandConfig {
  return BRANDS[brand ?? DEFAULT_BRAND] ?? BRANDS[DEFAULT_BRAND]
}

/**
 * Origine (scheme + host) à utiliser pour un LIEN PUBLIC envoyé à un client, selon la marque.
 * Enezo → `app.enezo.fr` ; coaching → son origine de prod (`tc-connect-two.vercel.app`).
 *
 * Les DEUX marques sont résolues explicitement (et non « enezo forcé, le reste au hasard du
 * domaine courant ») : sinon, depuis une PWA installée sur `app.enezo.fr`, basculer en espace
 * coaching continuerait de produire des liens `app.enezo.fr`. La marque passée ici est celle
 * de l'ESPACE ACTIF (sélecteur de marque) : changer d'espace change le lien.
 *
 * ⚠️ Volontairement absolu, y compris depuis localhost ou une preview Vercel : ces liens partent
 * chez un client, ils ne doivent jamais porter une adresse que lui ne peut pas ouvrir. Même parti
 * pris que `boutiqueLinkOrigin`. `currentOrigin` ne sert donc que de filet si une marque n'a pas
 * d'origine configurée.
 */
export function publicLinkOrigin(brand: Brand | null | undefined, currentOrigin: string): string {
  return brandConfig(brand).origine || currentOrigin
}

/**
 * Origine des liens PARTAGEABLES des apps de la BOUTIQUE (Bébé, CheckConnect…).
 * La boutique est rattachée à Enezo : un lien d'invitation envoyé à quelqu'un
 * d'extérieur doit toujours porter `app.enezo.fr`, quel que soit le domaine
 * depuis lequel on le génère (coaching, localhost, preview Vercel).
 *
 * ⚠️ À réserver aux liens qui SORTENT de l'app (copie, Web Share, mailto). Pour
 * une navigation interne (notification in-app, push d'un membre déjà connecté),
 * garder un chemin RELATIF : un lien absolu ferait sortir l'utilisateur de son
 * propre domaine.
 */
export function boutiqueLinkOrigin(currentOrigin?: string): string {
  const origin = currentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return publicLinkOrigin('enezo', origin)
}

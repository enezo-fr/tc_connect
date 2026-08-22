// App « Sarah & Ted » — référentiels et calculs.
//
// Listes reprises de l'ancienne app AppSheet (feuille « Listes déroulantes ») :
// Liste 4 (types d'activité), 9 (gamme de prix), 3 (priorité), 11 (film/série),
// 12 (plateformes), 13 (catégories). On garde l'existant pour que l'import
// retombe sur ses pieds sans ressaisie.

export const TYPES_FILM = ['Film', 'Série'] as const
/** ⚠️ « Autre » ne fait PAS partie de la liste : c'est une pastille qui ouvre un
 *  champ libre (`ChipsAutre`), et c'est le texte saisi qui est enregistré. */
export const PLATEFORMES = ['Netflix', 'Canal +', 'Prime Video', 'Disney+', 'Cinéma'] as const
export const CATEGORIES_FILM = [
  'Action', 'Aventure', 'Thriller', 'Comédie', 'Comédie dramatique', 'Braquage',
  'Fantastique', 'Biopic', 'Histoire vraie', 'Série documentaire', 'Film de Noël', 'Football',
] as const
/** Raccourcis de saisie du champ « Saison / partie » — la liste reste ouverte */
export const SAISONS_PARTIES = [
  'Saison 1', 'Saison 2', 'Saison 3', 'Saison 4', 'Saison 5',
  'Partie 1', 'Partie 2', 'Intégrale',
] as const

/** Même principe que PLATEFORMES : « Autre » est un déclencheur de champ libre. */
export const TYPES_ACTIVITE = [
  'Restaurant', 'Bar', 'Activité', 'Lieu', 'Parc', 'Vacances', 'Logement', "Aire d'autoroute",
] as const
export const PRIORITES = ['A faire absolument', 'A revoir', 'A ne pas faire'] as const
export const GAMMES_PRIX = ['🟢 Abordable', '🟡 Modéré', '🟠 Cher', '🔴 Exorbitant'] as const

// Le module Jeux (liste des jeux, classements, soirées, statistiques) vit
// désormais dans `lib/duoJeux.ts` : il a sa propre section d'écrans et n'a plus
// rien à faire dans les référentiels des deux listes « à voir » / « à faire ».

/**
 * Catégories d'un titre. Un film en porte plusieurs (`categories`) ; les fiches
 * importées d'AppSheet n'avaient qu'un seul champ texte (`categorie`), on le
 * relit ici pour ne pas avoir à migrer la base.
 */
export function categoriesFilm(f: { categories?: string[]; categorie?: string }): string[] {
  if (f.categories?.length) return f.categories
  return f.categorie ? [f.categorie] : []
}


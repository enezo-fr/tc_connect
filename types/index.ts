// src/types/index.ts
// Types TypeScript mappés depuis les schémas Firestore de Flutter
// Chaque type correspond à une collection Firestore

import { Timestamp } from 'firebase/firestore'

// Rôles
export type RoleApp = 'Admin' | 'Utilisateur'

// Droits d'accès par module (pour les Utilisateurs)
export interface Droits {
  planning: boolean        // Accès au planning et aux RDVs
  seances: boolean         // Accès aux séances et exercices
  notifications: boolean   // Accès aux notifications
  questionnaire: boolean   // Remplir questionnaire de forme + bilan séance (RPE, commentaire)
  compteRendu: boolean     // Voir le compte rendu du coach sur les RDVs
  exercices: boolean       // Bibliothèque d'exercices (opt-in)
  modifierProfil: boolean  // Modifier ses informations personnelles
  boutique: boolean        // Accès à la boutique
  parcoursSportif: boolean // Accès aux Parcours Sportifs (Mes Parcours)
}

export const DEFAULT_DROITS: Droits = {
  planning: true,
  seances: true,
  notifications: true,
  questionnaire: true,
  compteRendu: true,
  exercices: false,       // opt-in : désactivé par défaut
  modifierProfil: true,
  boutique: true,
  parcoursSportif: true,
}

// Collection : users
export interface User {
  id: string
  email: string
  display_name: string
  photo_url: string
  uid: string
  created_time: Timestamp
  phone_number: string
  indicatif_tel?: string
  nom: string
  prenom: string
  actif: boolean
  role_app: RoleApp
  droits?: Droits
  linkedClientId?: string   // si ce compte est rattaché à une fiche client (espace client Pilotage)
  marques?: ('coaching' | 'enezo')[]  // univers autorisés (« une app, deux portes ») — multi ; absent/vide = coaching
  marque?: 'coaching' | 'enezo'  // (DÉPRÉCIÉ) ancien champ mono-univers, gardé en repli de lecture
  // Contact d'urgence (éditable depuis le profil)
  contactUrgenceNom?: string
  contactUrgenceTel?: string
  contactUrgenceRelation?: string
  lastLoginAt?: Timestamp
  accueilShortcuts?: string[]
  documentsSeenAt?: Timestamp
}

// Collection : team
export interface Team {
  id: string
  userref: string
  nom_equipe: string
  sport: string
  create_date: Timestamp
  logo: string
}

// Collection : joueurs
export interface Joueur {
  id: string
  equiperef: string
  iduserref: string
  create_date: Timestamp
  type: string
  type_staff: string
  mail_joueur: string
  prenom_joueur: string
  nom_joueur: string
  date_naissance: Timestamp
}

// Collection : planning_pro
export interface PlanningPro {
  id: string
  ref_users: string
  date_planning: Timestamp
  heure_planning_debut: Timestamp
  heure_planning_fin: Timestamp
  etat_planning_rdv: string
  adresse_rdv: string
  rdv_pret: string
  rdv_effectue: string
  observations_rdv: string
  // Questionnaire de forme
  qualite_sommeil: number
  niveau_fatigue: number
  niveau_courbatures: number
  quantite_stress: number
  motivation_avant_seance: number
  activite_derniers_jours: number
  alimentation_derniers_jours: number
  infos_complementaires_avant_seance_client: string
  questionnaire_rempli: boolean
  douleurs?: PainPoint[]
}

// Collection : seance
export interface Seance {
  id: string
  ref_planning: string
  partie_seance: string
  type_seance: string
  observations_seance: string
  nb_tours: number
  recup_tours: number
  tps_recup_exo_default?: number
  type_effort_exo_default?: string
  tps_effort_exo_default?: number
  ref_users: string
  num_circuit: number
  avancement_circuit: number
  nb_exercice: number
  intensite_circuit?: number
  intensite_circuit_planifie?: number
  date_create?: any
}

// Collection : programme_seance
export interface ProgrammeSeance {
  id: string
  ref_seance: string
  exercice: string
  explication_exercice: string
  type_effort: string
  effort: number
  recup_effort: number
  tempo_phase1: number
  tempo_phase2: number
  tempo_phase3: number
  charges?: number[]          // Charge par tour [tour1, tour2, ...]
  notes_utilisateur?: string
  nb_serie_effectuee?: number
  num_exercice?: number
  alerte_exercice?: string
  raison_alerte_exercice?: string
  intensite_exercice?: string
}

// Collection : exercices
export interface Exercice {
  id: string
  partie_prioritaire: string
  nom_exercice: string
  image_exercice: string
  video_exercice: string
  lien_exercice: string
  explications_commentees_exercice: string
  Materiel: string[]
  Muscles: string[]
}

// Collection : rpe
export interface RPE {
  id: string
  joueurref: string
  date: Timestamp
  rpe: number
  temps: number
  date_create: Timestamp
  charge_entrainement: number
  charge_aigue: number
  charge_chronique: number
  rcac: number
}

// Collection : notes_historique
export interface NoteHistorique {
  id: string
  ref_users?: any              // DocumentReference | null
  ref_client?: string          // ID direct dans la collection clients
  notes: string
  date_create: Timestamp
  type_note: string
  date_max_note_active?: Timestamp | null
}

// Collection : parcours_notes (notes sur les participants du parcours sportif)
export interface ParcoursNoteApplication {
  sessionId: string
  sessionTitle?: string
  sessionDate?: Timestamp | null
  registrationId: string
  amount: number
  appliedAt: Timestamp
}

export interface ParcoursNote {
  id: string
  participantKey: string        // clé du participant (email ou nom|prénom)
  participantName?: string      // nom dénormalisé pour affichage
  type_note: string
  notes: string
  montant?: number | null       // montant initial pour les paiements anticipés
  montantMethode?: 'cash' | 'transfer' | null // moyen de paiement de l'avance (pour les stats)
  montantConsomme?: number      // montant déjà appliqué à des séances (Option C)
  applications?: ParcoursNoteApplication[] // historique des applications
  date_create: Timestamp
  date_max_note_active?: Timestamp | null
}

// Collection : parcours_indications
// Annonces / alertes affichées sur la page publique du Parcours Sportif (ex : alerte canicule).
export type ParcoursIndicationNiveau = 'info' | 'avertissement' | 'urgent'

export interface ParcoursIndication {
  id: string
  titre: string
  message: string
  niveau: ParcoursIndicationNiveau
  portee: 'global' | 'session'   // global = tout le parcours ; session = une séance précise
  sessionId?: string | null       // renseigné si portee === 'session'
  surSeances?: boolean            // portée globale : afficher aussi sur les séances concernées (défaut true)
  ordre?: number                  // ordre d'affichage manuel (croissant ; sans valeur = à la fin)
  dateDebut: Timestamp            // début de la fenêtre d'affichage
  dateFin: Timestamp              // fin de la fenêtre d'affichage (jour inclus)
  createdAt: Timestamp
}

// Champs des contrats légaux (portés par le contrat, réutilisés par les documents officiels)
export interface LegalFields {
  prestataireNom: string
  prestataireStatut: string
  prestataireSiret: string
  prestataireAdresse: string
  prestataireEmail: string
  prestataireTel: string
  prestataireRepresentant: string
  clientNom: string
  clientRepresentant: string
  clientAdresse: string
  clientSiret: string
  date: string
  lieu: string
  objet: string
  prixCreation: string
  prixAbo: string
  donneesTraitees: string
  finalites: string
  personnesConcernees: string
  dureeConservation: string
  sousTraitantsUlterieurs: string
  etendueDroits: string
  exclusivite: string
  territoire: string
  duree: string
  // Forfait d'ajustements inclus après validation de la maquette (clause du contrat de prestation)
  ajustementsInclus: string
  // Modalité « Reconduction & résiliation » du devis (préavis, plafond de révision tarifaire…).
  // Vide = texte standard auto (préavis 2 mois, révision annuelle possible).
  reconduction: string
  // Clause de référence commerciale (contrat de prestation), tri-état 'oui'/'non' :
  // 'oui' (défaut) = insère un article autorisant le Prestataire à citer le nom/logo du Client
  // et à présenter l'app réalisée dans sa communication (par dérogation à la confidentialité).
  // 'non' = pas d'article. Tri-état (pas vide) pour que le décochage PERSISTE au rechargement
  // (resetForms n'écrase le défaut qu'avec une valeur sauvegardée non-vide).
  clauseReference?: string
}

// Contenu structuré « projet » (partagé par le contrat, réutilisé par les documents)
export interface ProjetFonction { categorie: string; description: string; taille?: 'xs' | 's' | 'm' | 'l' | 'xl' }  // taille = durée (sync calculateur)
export interface ProjetPlanning {
  etape: string
  description: string
  date: string            // date résolue (AAAA-MM-JJ) ; statut dérivé de la date (passée = faite)
  dureeJours?: number     // délai en jours jusqu'à l'étape suivante (cascade)
  ancre?: boolean         // true = date fixée à la main (non recalculée)
  responsable: string     // 'Développeur' | 'Client' | 'Les deux' (chips ; texte libre toléré pour l'existant)
}
export interface ProjetTache {
  description: string; date: string; fait: boolean
  pour: 'client' | 'sc'                                  // qui réalise la tâche (client ou moi/Enezo ; valeur 'sc' = interne, affichée « Moi »)
  facturation?: 'inclus' | 'maintenance' | 'facturer'    // statut de facturation (évolution payante ?)
  tempsH?: number                                        // temps estimé en heures (si « à facturer ») → prix = tempsH × TJM/7
  facturee?: boolean                                     // déjà facturée (sort de l'alerte « à facturer »)
}
export interface ProjetContent {
  contexte: string
  fonctionnalites: ProjetFonction[]
  livrables: string[]
  horsPerimetre: string[]   // ce qui n'est PAS compris dans la prestation
  planning: ProjetPlanning[]
  taches: ProjetTache[]     // liste unique ; chaque tâche indique si elle est « pour » le client ou pour moi
}

// Charte graphique & cadrage du projet (onglet dédié du contrat)
export interface ChartCouleur { label: string; hex: string }
export interface ChartGraphique {
  objectifs?: string[]                                          // objectifs du projet (liste)
  typeProjet?: 'application' | 'site_web' | 'autre' | 'app_mobile' | 'app_web'  // application / site / autre (app_mobile & app_web = legacy)
  typeAutre?: string                                            // précision libre si typeProjet === 'autre'
  nomProjet?: string                                            // nom du projet (distinct du nom commercial de l'app)
  nomApp?: string
  publicCible?: string
  usersMin?: number                                             // nb d'utilisateurs envisagé (bornes)
  usersMax?: number
  plateformes?: string[]                                        // 'ios' | 'android' | 'web'
  domaine?: string                                              // nom de domaine souhaité
  langues?: string[]                                            // liste (avec drapeaux), présélections
  couleurs?: ChartCouleur[]                                     // primaire / secondaire / accent…
  typographie?: string[]                                        // liste de polices
  ton?: string[]                                                // liste : moderne, sobre, fun…
  liens?: string[]                                              // références / inspirations
  contraintes?: string[]                                        // contraintes & spécifications techniques (liste)
  notes?: string                                                // contraintes de marque, do/don't…
  logo?: { name: string; url: string }                         // logo (élément à part entière, Storage)
  fichiers?: { name: string; url: string }[]                   // autres images/fichiers (Storage)
}

// Snapshot des entrées du calculateur de tarif, attaché au contrat pour pouvoir rouvrir/ajuster le calcul.
export interface PilotageEstimationFeature { nom: string; taille: 'xs' | 's' | 'm' | 'l' | 'xl'; description?: string; categorie?: string }
export interface PilotageEstimation {
  mode: 'metier' | 'revente'
  tjm: number
  overheadPct: number
  bufferPct: number
  maintPct: number
  infra: number
  supportH: number
  heuresGagnees: number
  coutHoraireClient: number
  partCaptee: number
  premiumRevente: number
  nbClientsFinaux: number
  prixReventeMensuel: number
  outilsMensuel?: number   // coût mensuel des outils/abonnements (ex : Claude Code) — dilué dans le prix
  joursFactures?: number   // jours facturés / an (pour répartir le coût des outils sur la journée)
  urssafPct?: number       // cotisations sociales (URSSAF) en % du CA — pour calculer le net
  remiseSetupPct?: number  // remise « tarif d'ami » sur la création / mise en service (%)
  remiseAboPct?: number    // remise « tarif d'ami » sur l'abonnement (%)
  features: PilotageEstimationFeature[]
}

// Collection : pilotage_immobilisations (achats de matériel à amortir / répartir dans le temps)
export interface PilotageImmobilisation {
  id: string
  label: string
  montant: number            // prix d'achat (TTC)
  dateAchat?: string | null  // ISO yyyy-mm-dd (optionnel)
  dureeAns: number           // durée d'amortissement (années)
  createdAt: Timestamp
}

// Estimation nommée enregistrée sur un contrat (plusieurs possibles, ex : « client final » / « revendeur »)
export interface SavedEstimation extends PilotageEstimation {
  id: string
  label: string
}

// Collection : pilotage_contrats (pilotage de l'activité — contrats clients pro)
export type PilotageContratStatut = 'prospect' | 'actif' | 'pause' | 'termine'

// Suivi périodique récurrent d'un contrat (relevé quota, révision tarifaire…) — Pilotage Phase 2.
// L'échéance se calcule depuis `dernierFait` (ou la date de début du contrat) + `intervalleMois`.
export interface SuiviPeriodique {
  id: string
  label: string
  intervalleMois: number    // périodicité en mois
  dernierFait?: string      // AAAA-MM-JJ ; vide = jamais fait (ancré sur dateDebut/createdAt)
  note?: string
}

// Entrées de l'estimateur de coûts d'infra (Firebase) — voir components/pilotage/InfraCostEstimator.tsx
export interface InfraInputs {
  users: number
  sessionsMois: number
  lecturesSession: number
  ecrituresSession: number
  stockageFichiersGo: number
  stockageVideoGo: number
  bandePassanteSessionMo: number
  vercelMensuel?: number   // hébergement web (Vercel) — coût fixe /mois (part du plan Pro), pas dérivé de l'usage
}

export interface PilotageContrat {
  id: string
  clientId?: string | null      // client relié (collection clients)
  clientNom: string             // nom du client / entreprise
  abonnementId?: string | null  // abonnement relié (collection abonnements)
  abonnementTitre?: string | null // libellé de l'abonnement relié (affichage)
  appNom?: string               // (déprécié) ancienne « app vendue »
  fraisMiseEnPlace?: number     // frais ponctuels au démarrage (= tarif normal/catalogue ; net = après remise)
  abonnementMensuel?: number    // revenu récurrent /mois (= tarif normal ; net = après remise)
  remiseMiseEnPlacePct?: number // remise % sur la mise en service (affichée barrée sur le devis ; le client paie le net)
  remiseAbonnementPct?: number  // remise % sur l'abonnement mensuel
  coutFirebaseMensuel?: number  // coût d'infra estimé /mois (pour la marge)
  tjm?: number                  // TJM du contrat (sert au prix des tâches « à facturer ») ; sinon estimation.tjm puis réglage global
  dateDebut?: Timestamp
  premiereAnnee?: boolean       // tarif « 1ère année » → à revoir ensuite
  tarifAnnee2Defini?: boolean   // le tarif année 2 a-t-il été décidé ?
  devisId?: string | null       // devis validé relié (source de vérité du deal)
  devisNumber?: string | null   // numéro du devis relié (affichage)
  statut: PilotageContratStatut
  version?: string              // version du projet/contrat (éditable) — reprise par TOUS les documents générés
  dureeEngagementMois?: number  // durée d'engagement de l'abonnement (mois ; défaut 12) → calcul reconduction/préavis « À suivre »
  preavisMois?: number          // préavis de non-reconduction (mois ; défaut 2)
  maquetteValideeLe?: string    // jalon « maquette validée » (AAAA-MM-JJ) → gèle le périmètre + rappel transitoire « À suivre »
  suivisPeriodiques?: SuiviPeriodique[]  // suivis récurrents (relevé quota, révision tarifaire…) → échéances « À suivre » (Phase 2)
  portalToken?: string | null   // jeton d'accès à l'espace client public (/espace/[token]) — généré à la demande, régénérable = révocation
  /** (legacy) Note de fiche — les notes passent désormais par le journal. */
  notes?: string
  projet?: ProjetContent       // contenu projet partagé (rempli une fois, réutilisé par les documents)
  legal?: LegalFields          // infos des documents officiels (prestataire, client, RGPD, licence…)
  charte?: ChartGraphique      // charte graphique & cadrage (type, couleurs, utilisateurs, contraintes…)
  optionsDevis?: DevisOption[]    // options à la carte chiffrées proposables sur le devis (hors total)
  objetDevis?: string             // objet du devis (offre) — si vide, généré auto depuis nom/type/structure de l'offre
  miseEnServiceDesc?: string      // description de la ligne « Mise en service » — si vide, dérivée des livrables
  abonnementDesc?: string         // description de la ligne « Abonnement mensuel » — si vide, texte standard
  valeurBannerOverride?: {        // réglages du bandeau « valeur » (contenu auto depuis l'estimation)
    masque?: boolean              // true = ne pas afficher le bandeau du tout
  }
  masqueAlerteAlignement?: boolean // (déprécié) ancien flag « ne plus jamais afficher l'alerte d'alignement »
  alerteAlignementIgnoree?: string // signature des chiffres ignorés : tant qu'ils ne bougent pas, l'alerte
                                   // « estimation ≠ contrat » reste masquée ; si un chiffre change → réapparaît
  evolution?: DevisEvolution      // section « Évolution » optionnelle du devis (revente / white-label)
  hebergement?: {                 // quota d'hébergement inclus dans l'abonnement (modalité auto du devis)
    utilisateursInclus?: number   // nb d'utilisateurs actifs inclus (sinon fallback charte.usersMax)
    depassement?: string          // texte « au-delà : … » (sinon texte standard « refacturé au réel »)
  }
  coutFirebaseInputs?: InfraInputs  // entrées saisies dans l'estimateur de coûts d'infra (réutilisées à la réouverture)
  estimation?: PilotageEstimation // (legacy) snapshot unique du calculateur — voir `estimations`
  estimations?: SavedEstimation[] // plusieurs estimations nommées à comparer (calculateur de la fiche contrat)
  estimationSelectedId?: string | null // estimation « validée » → son TJM pilote les tâches à facturer
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// Collection : pilotage_catalogue (briques de fonctionnalités réutilisables pour l'estimateur)
export interface PilotageCatalogueItem {
  id: string
  nom: string
  taille: 'xs' | 's' | 'm' | 'l' | 'xl'  // mappe sur TAILLES (jours d'effort)
  groupe: string                          // ex : « Fonctionnelles », « Souvent oubliées »
  createdAt: Timestamp
}

// Collection : pilotage_documents (documents projet & contrats légaux reliés à un contrat)
export type PilotageDocumentType =
  | 'cahier_charges' | 'besoins_client' | 'bilan'   // documents projet
  | 'prestation' | 'dpa_rgpd' | 'cgv' | 'licence'   // contrats légaux

export type PilotageDocumentStatut = 'brouillon' | 'finalise' | 'signe'

export interface PilotageDocument {
  id: string
  contratId: string
  clientNom?: string
  type: PilotageDocumentType
  titre: string
  version: string
  statut: PilotageDocumentStatut
  contenu?: Record<string, unknown>   // données structurées (remplies aux phases suivantes)
  signe?: boolean                     // signé côté PRESTATAIRE (case « roleA » du PDF)
  signeLe?: Timestamp | null
  signatairePar?: string | null
  signatureUrl?: string | null        // image de la signature prestataire (Storage) — repli sur Company.signatureUrl si absente
  // Signature du CLIENT posée depuis l'espace client (case « roleB » du PDF)
  clientSigne?: boolean
  clientSigneLe?: Timestamp | null
  clientSignatairePar?: string | null
  clientSignatureUrl?: string | null   // image de la signature client (data URL) — stockée telle quelle, sans Storage
  // Instantané des données exactes rendues au dernier PDF admin : l'espace client régénère à l'identique
  renderSnapshot?: { legal?: Record<string, unknown>; projetContexte?: string } | null
  pdfUrl?: string | null               // PDF généré stocké (Storage) — ouvert tel quel, régénérable
  pdfNom?: string                      // nom de fichier du PDF stocké
  pdfGeneeLe?: Timestamp | null        // date de génération du PDF stocké
  pdfReflectsSignature?: boolean       // le PDF stocké reflète l'état de signature courant (sinon = à régénérer admin-side)
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// Collection : pilotage_settings (valeurs par défaut du calculateur de tarif)
export interface PilotageSettings {
  tjm?: number
  overheadPct?: number
  bufferPct?: number
  maintPct?: number
  infra?: number
  supportH?: number
  heuresGagnees?: number
  coutHoraireClient?: number
  partCaptee?: number
  // Mode « app à revendre » (revendeur / marque blanche)
  premiumRevente?: number      // % en plus sur la création (droits commerciaux)
  nbClientsFinaux?: number     // clients finaux visés par le revendeur
  prixReventeMensuel?: number  // prix de revente par client final /mois
  outilsMensuel?: number       // coût mensuel des outils/abonnements (ex : Claude Code), dilué dans le prix
  joursFactures?: number       // jours facturés / an (pour répartir le coût des outils)
  urssafPct?: number           // cotisations sociales (URSSAF) en % du CA — pour calculer le net
  // Liste de fonctionnalités de départ du calculateur (durée/complexité par défaut)
  features?: { nom: string; taille: 'xs' | 's' | 'm' | 'l' | 'xl' }[]
  // Étapes-types proposées dans le planning prévisionnel (liste déroulante éditable)
  planningEtapes?: string[]
  // Modèle de planning prévisionnel (généré en un clic, éditable) — dates ignorées, recalculées à la génération
  planningTemplate?: ProjetPlanning[]
  // Valeurs par défaut des mentions légales (durée, droits, exclusivité, RGPD…) appliquées aux nouveaux contrats.
  // Clés = clés de LegalFields (string → string). Voir lib/pilotageLegalTemplates.
  legalDefaults?: { [key: string]: string }
  // Modèle de la section « Évolution » du devis (chargeable en 1 clic sur un contrat — PAS auto).
  evolutionDefault?: DevisEvolution
  // Valeurs par défaut de l'estimateur de coûts d'infra (modèle pré-rempli sur les nouveaux estimateurs).
  coutFirebaseInputs?: InfraInputs
}

// Collection : Notifications
export interface Notification {
  id: string
  refUsers: string
  type_notification: string
  notification: string
  etat_notification: string
  date_create: Timestamp
  date_lecture: Timestamp
  date_declenchement: Timestamp
  action_via_planning: string
  type_vue_pour_cond_action: string
  url?: string
  ref_planning?: any
}

// Collection : calendrier_team
export interface CalendrierTeam {
  id: string
  teamref: string
  date: Timestamp
  heure_debut: Timestamp
  heure_fin: Timestamp
  event: string
  create_date: Timestamp
}

// Collection : seances_equipe
export interface SeanceEquipe {
  id: string
  teamId: string
  date: Timestamp
  heureDebut?: string        // "HH:MM"
  type: 'Entraînement' | 'Match' | 'Physique' | 'Technique' | 'Tactique' | 'Récupération'
  dureeMin: number           // durée prévue en minutes
  notes?: string
  statut: 'planifiée' | 'terminée' | 'annulée'
  joueurIds: string[]        // IDs des joueurs participants
  hoopers: Record<string, {  // clé = joueurId
    sommeil: number; fatigue: number; courbatures: number; stress: number
    indiceHooper: number; submittedAt: Timestamp
  }>
  rpes: Record<string, {     // clé = joueurId
    rpe: number; dureeMin: number; charge: number; submittedAt: Timestamp
  }>
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// Collection : database_users_details (Flutter app — ne pas modifier)
export interface DatabaseUsersDetails {
  id: string
  refUsers?: string
  titre_abo?: string
  categorie_prestation: string
  type_suivi: string
  resume_suivi: string
  objectifs: string
  date_debut?: Timestamp
  date_fin?: Timestamp
  indications: string
  arret_suivi: string
  etat: string
}

// ─── Système de facturation (collections indépendantes) ──────────────────────

// ─── Sous-types fiche client ─────────────────────────────────────────────────

export interface Objectif {
  texte: string
  priorite: 'Primaire' | 'Secondaire' | 'Tertiaire'
  dateObjectif?: string
  donneeChiffree?: string
  commentaire?: string
}

export interface MouvementDetail {
  label: string
  intensite: number   // 0-10
}

export interface ZoneCorporelle {
  partie: string       // ex : "Épaule", "Genou"
  cote?: string        // "Gauche" | "Droite" | "Bilatéral"
  structure?: string   // ex : "LCA", "Coiffe des rotateurs"
}

export interface AntecedentMedical {
  description: string
  typeBlessure?: string          // 'Osseuse' | 'Tendineuse' | 'Musculaire' | 'Ligamentaire' | 'Neurologique' | 'Chronique / Maladie' | 'Autre'
  estContreIndication?: boolean  // contre-indication pour les exercices
  estChronique?: boolean         // condition permanente (asthme, diabète...)
  cote?: string                  // legacy global side (kept for backward compat)
  zonesCorps?: ZoneCorporelle[]  // zones anatomiques avec côté et structure
  anneeDebut?: string
  anneeFin?: string              // vide si toujours présent
  arretSport?: string            // ex: "3 mois", "6 semaines"
  douleurPresente?: boolean
  mouvementsDetail?: MouvementDetail[]   // mouvements douloureux avec intensité par mouvement
  // Legacy — kept for backward-compat reading of old Firestore docs
  gradeDouleur?: number          // 0-10 (remplacé par intensite dans mouvementsDetail)
  mouvementsDouloureux?: string  // comma-separated (remplacé par mouvementsDetail)
  operation?: boolean
  dateOperation?: string         // ISO date
  // Legacy
  annee?: string
}

export interface AntecedentSportif {
  sport: string
  anneeDebut: string
  anneeFin: string
  niveau: string
}

export interface MaterialItem {
  nom: string
  localisation?: string
  observations?: string
}

export interface StructureItem {
  nom: string
  adresse?: string
  observations?: string
}

export interface AutreCoachItem {
  service?: string
  nom?: string
  tel?: string
  mail?: string
  observations?: string
}

export interface SuiviPasse {
  service?: string
  nom?: string
  tel?: string
  mail?: string
  observations?: string
}

export interface PlanningSlot {
  activite: string
  heureDebut?: string
  duree?: string
}

// Legacy — kept for backward-compat reading of old Firestore docs
export interface ContraindicationItem {
  description: string
  annee: string
  gravite: string
  cote: string
}

export interface ContactSupplementaire {
  label?: string        // ex: "Employeur", "Conjoint", "Société"
  nom?: string
  prenom?: string
  adresse?: string
  codePostal?: string
  ville?: string
  telephone?: string
  email?: string
  factureParDefaut?: boolean   // utiliser ces coordonnées par défaut pour la facturation
}

// Collection : clients (indépendant de Firebase Auth)
export interface Client {
  id: string
  userId: string            // UID du coach propriétaire
  marques?: ('coaching' | 'enezo')[]  // univers de rattachement (« une app, deux portes ») — multi ; absent/vide = coaching
  marque?: 'coaching' | 'enezo'  // (DÉPRÉCIÉ) ancien champ mono-univers, gardé en repli de lecture
  prenom: string
  nom: string
  email?: string
  telephone?: string
  indicatif_tel?: string
  genre?: string
  dateNaissance?: Timestamp
  adresse?: string
  ville?: string
  codePostal?: string
  profession?: string
  sportPratique?: string
  niveauSportif?: string    // Loisir / Débutant / Intermédiaire / Confirmé / Expert
  // Champs structurés
  objectifs?: Objectif[]
  antecedentsMedicaux?: AntecedentMedical[]
  antecedentsSportifs?: AntecedentSportif[]
  // Équipement & services (nouvelle structure tableau)
  materielItems?: MaterialItem[]
  structureItems?: StructureItem[]
  autreCoachItems?: AutreCoachItem[]
  suivisPassesItems?: SuiviPasse[]
  // Contact d'urgence
  contactUrgenceNom?: string
  contactUrgenceTel?: string
  contactUrgenceRelation?: string
  // Logistique séances
  lieuSeance?: string
  lieuSeanceLat?: number
  lieuSeanceLng?: number
  distanceKm?: number
  tempsRouteSeance?: string
  nbSeancesParSemaine?: number
  nbSeancesMin?: number
  nbSeancesMax?: number
  planningSlots?: Record<string, PlanningSlot[]>
  planningDispoSlots?: Record<string, string[]>
  // Conditions de vie
  joursTravail?: string[]
  positionTravail?: string
  tempsRouteTravail?: string
  tempsTravailSemaine?: string
  // NAP
  napCategorie?: string
  // Commercial
  statut?: 'Prospect' | 'Actif' | 'Inactif'
  pipelineStage?: 'nouveau' | 'contacte' | 'rdv' | 'devis' | 'nego' | 'signe' | 'perdu'  // étape du pipeline de vente (prospects)
  pipelineUpdatedAt?: Timestamp   // dernier changement d'étape (tri / « dernier contact »)
  commentConnuCoach?: string
  // Entreprise
  siret?: string
  nomEntreprise?: string
  adresseEntreprise?: string
  representantEntreprise?: string   // nom du représentant légal (pour les contrats)
  // Contacts supplémentaires (facturation alternative)
  contactsSupplementaires?: ContactSupplementaire[]
  // Legacy (rétrocompat lectures anciennes données Firestore)
  contraindicationsList?: ContraindicationItem[]
  materielMaison?: boolean
  materielMaisonDetail?: string
  structureRemiseForme?: boolean
  structureRemiseFormeDetail?: string
  autreCoach?: boolean
  autreCoachNom?: string
  autreCoachTel?: string
  autreCoachMail?: string
  autreCoachService?: string
  planningType?: Record<string, string>
  objectifsPrincipaux?: string
  antecedentsMedicauxLegacy?: string
  contraindications?: string
  notes?: string
  linkedUserId?: string           // Lien optionnel vers collection users (compte app)
  seanceAccessExpiry?: Timestamp  // Date d'expiration d'accès aux séances en ligne (après arrêt)
  actif: boolean
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// Collection : companies (sociétés de facturation)
export interface Company {
  id: string
  userId: string            // UID du coach propriétaire
  nom: string
  adresse?: string
  codePostal?: string
  ville?: string
  email?: string
  telephone?: string
  representant?: string      // nom du représentant légal (pour les contrats)
  siret?: string
  tva?: string
  iban?: string
  bic?: string
  logoUrl?: string
  signatureUrl?: string     // signature du prestataire (data URL ou URL) — affichée côté « Le prestataire » sur les devis
  mentionsLegales?: string
  couleurPrimaire?: string  // ex : "#2563eb"
  marque?: 'coaching' | 'enezo'  // univers de la société (« une app, deux portes ») : pilote le thème du lien public de signature de devis ; absent = coaching
  cgv?: string              // Conditions générales de vente (texte complet)
  cgvDate?: string          // Date de mise à jour des CGV (ex : "2024-01-15")
  createdAt: Timestamp
}

// ─── Douleurs (questionnaire de forme) ───────────────────────────────────────
export interface PainPoint {
  zone: string           // ex: "genou_g", "lombaires"
  intensite: number      // 0-10
  type: string           // ex: "Pincement", "Brûlure", "Élancement"
}

// Collection : abonnements
export type AbonnementEtat = 'Prospect' | 'Actif' | 'Inactif' | 'En attente' | 'Terminé' | 'Suspendu'

export interface Abonnement {
  id: string
  userId: string            // UID du coach
  clientId: string
  companyId?: string
  companyNom?: string
  titre?: string            // kept for backward compat
  categorie: string         // 'Teddy Coaching' | 'FFD' | 'EMF' | 'Enezo' (ex 'S&C')
  typeSuivi?: string        // kept for backward compat
  frequence?: string
  tarifUnitaire?: number
  tarifLabel?: string
  dateDebut?: Timestamp
  dateFin?: Timestamp
  etat: AbonnementEtat
  nbSeancesTotal?: number
  objectifs?: Objectif[]
  resumeSuivi?: string      // kept for backward compat
  indications?: string
  contraindications?: string // kept for backward compat
  notes?: string             // kept for backward compat
  notesInternes?: Array<{ texte: string; type_note: string }>
  arretSuivi?: string   // raison de non reconduction (écrit aussi dans database_users_details.arret_suivi)
  sansRappelRenouvellement?: boolean  // true = ne pas envoyer de push de renouvellement pour cet abo (reste visible dans le bandeau/filtre « À renouveler »)
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// Collection : factures
export type FactureStatus = 'draft' | 'pending' | 'sent' | 'paid' | 'encaissement' | 'overdue' | 'cancelled' | 'accepted' | 'rejected'
export type FactureType = 'facture' | 'devis'

// Section « Évolution » optionnelle d'un devis (ex : revente / white-label) — bloc structuré.
export interface DevisEvolutionEtape { titre: string; description?: string; prix?: string }
export interface DevisEvolutionPanneau { titre: string; reco?: boolean; items: string[]; prix?: string }
export interface DevisEvolution {
  masqueDevis?: boolean     // true = ne pas afficher sur le devis client (reste visible sur la Fiche négo interne)
  titre?: string            // titre de section (défaut « Évolution possible »)
  tag?: string              // pastille (ex : « Informatif · non inclus »)
  intro?: string            // paragraphe d'introduction
  qaQuestion?: string       // question mise en avant (bloc Q/R)
  qaDetail?: string         // détail sous la question
  qaReponse?: string        // réponse courte (ex : « Oui ✓ »)
  etapes?: DevisEvolutionEtape[]      // étapes chiffrées (titre + desc + prix)
  panneaux?: DevisEvolutionPanneau[]  // options/modèles en 2 colonnes (B1 reco / B2…)
  tableau?: string          // tableau de prix : 1 ligne/rangée, cellules séparées par « | », 1re ligne = en-têtes
  note?: string             // note de bas de section
}

export interface FactureItem {
  label: string
  quantity: number
  price: number
  discountType?: 'percent' | 'amount'
  discountValue?: number
  description?: string                          // sous-description détaillée (ce que la ligne inclut) — devis de prestation
  recurrence?: 'unique' | 'mensuel' | 'annuel'  // 'unique' (défaut) = forfait one-off ; 'mensuel'/'annuel' = récurrent (price = prix par période)
}

// Option à la carte chiffrée (hors total), proposée sur un devis de prestation
export interface DevisOption {
  label: string
  description?: string
  prixMin?: number
  prixMax?: number          // si défini → affiché en fourchette « prixMin – prixMax » ; sinon prix unique (prixMin) ou « sur devis »
}

export interface Echeance {
  date: Timestamp
  montant: number
  statut: 'en_attente' | 'payé'
  label?: string
}

export interface EcheanceRef {
  label: string    // libellé de l'échéance (ex : "Acompte 50%")
  montant: number  // montant de cette échéance uniquement
  index: number    // 0-based
  count: number    // nombre total d'échéances du devis
  cumulPrecedent?: number  // somme des échéances précédentes (déjà réglées avant celle-ci)
}

export interface Facture {
  id: string
  userId: string
  clientId: string
  clientName: string
  companyId?: string
  companyNom?: string
  abonnementId?: string
  abonnementTitre?: string
  number: string
  status: FactureStatus
  type: FactureType
  items: FactureItem[]
  total: number
  // Devis de prestation enrichi (optionnel — vide = devis/facture classique inchangé)
  objet?: string                       // « Objet du devis » (narratif)
  contratId?: string | null            // contrat Pilotage source (si généré depuis un contrat)
  validiteJours?: number               // durée de validité du devis (jours ; défaut 30 à l'affichage)
  inclus?: string[]                    // « Ce qui est inclus » — checklist (modules livrés)
  inclusPanels?: { titre: string; items: string[] }[]  // « Ce qui est inclus » en panneaux titrés (ex. Mise en service / Abonnement)
  valeurBanner?: {                     // bandeau « valeur » mis en avant sous les totaux
    titre?: string
    sousTitre?: string
    montant?: string                   // gros chiffre affiché à droite (déjà formaté)
    mention?: string                   // petite légende sous le chiffre (ex. « VALEUR ESTIMÉE / AN »)
    texte?: string                     // paragraphe explicatif
    stats?: { value: string; label: string }[]  // ligne de stats (ex. jours, modules…)
  }
  modalites?: { label: string; value: string }[]  // bloc Modalités (paiement, délai, PI, RGPD…)
  options?: DevisOption[]              // options à la carte chiffrées (hors total)
  evolution?: DevisEvolution           // section « Évolution » optionnelle (revente / white-label)
  echeances?: Echeance[]
  echeanceRef?: EcheanceRef  // présent sur les factures issues d'un devis à échéancier
  notes?: string
  date?: Timestamp                  // Date d'émission du document (modifiable)
  dateEcheance?: Timestamp          // Date de paiement prévue (échéancier uniquement)
  devisRef?: string                 // ID du devis d'origine
  devisNumber?: string              // Numéro du devis d'origine
  signed?: boolean                  // Devis signé électroniquement
  signedAt?: Timestamp
  signatureUrl?: string              // URL Firebase Storage de l'image de signature
  signToken?: string | null          // jeton d'accès au lien public de signature (/signer-devis/[token]) — généré à la demande, régénérable = révocation
  pdfUrl?: string                    // URL Firebase Storage du PDF généré
  pdfReflectsSignature?: boolean     // le PDF stocké (pdfUrl) reflète l'état de signature courant (sinon = à régénérer)
  convertedToFactureId?: string      // Facture créée depuis ce devis (legacy single)
  convertedToFactureIds?: string[]   // Toutes les factures créées depuis ce devis
  clientLinkedUserId?: string          // Firebase Auth UID du client (pour requêtes côté utilisateur)
  clientAddress?: string
  clientVille?: string
  clientCodePostal?: string
  // Coordonnées de facturation (override si différent du client)
  factureNom?: string
  factureAdresse?: string
  factureCodePostal?: string
  factureVille?: string
  factureEmail?: string
  factureTelephone?: string
  paymentDate?: Timestamp
  paymentMethod?: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

// ─── URSSAF ───────────────────────────────────────────────────────────────────

export interface UrssafPeriode {
  id: string
  userId: string
  annee: number
  mois: number            // 1-12
  taux: number            // taux de cotisations en % (ex: 24.2)
  declare: boolean
  dateDeclaration?: Timestamp
  regle: boolean
  dateReglement?: Timestamp
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// ─── Boutique / Store ─────────────────────────────────────────────────────────

export interface StoreApp {
  id: string
  nom: string
  shortDesc: string        // accroche courte pour la carte
  description: string      // texte long
  icon: string             // emoji (fallback si pas de logo image)
  iconUrl?: string         // logo image (URL Firebase Storage) — prioritaire sur l'emoji
  couleur: string          // hex e.g. "#6366f1"
  prix: number
  periodicite: 'mensuel' | 'annuel' | 'unique'
  actif: boolean
  ordre: number
  route?: string           // route interne e.g. "/boutique/belote"
  tags?: string[]
  visibleUserIds?: string[]
  hiddenUserIds?: string[]
  changelogs?: StoreChangelog[]
  limitesConfig?: StoreLimiteConfig[]
  createdBy: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}

export interface StoreReview {
  id: string
  appId: string
  userUid: string
  clientNom: string
  rating: number           // 1-5
  comment?: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}

export interface StoreChangelog {
  id: string
  title: string
  description?: string
  type: 'update' | 'upcoming'
  date: Timestamp
}

export interface StoreLimiteConfig {
  key: string
  label: string
  defaultValue: number
}

export type StoreSubStatut = 'active' | 'suspended' | 'cancelled' | 'pending'

export type StoreSubEventType =
  | 'created'        // demande de souscription
  | 'activated'      // accès validé / activé par l'admin
  | 'renewed'        // paiement validé / renouvelé
  | 'reminder'       // relance envoyée
  | 'suspended'      // suspendu (échéance dépassée ou admin)
  | 'cancelled'      // annulé / arrêté
  | 'unsubscribed'   // désabonnement par l'utilisateur
  | 'archived'       // archivé (retiré des alertes)
  | 'cleaned'        // données purgées

export interface StoreSubEvent {
  type: StoreSubEventType
  date: Timestamp
  note?: string
}

export interface StoreSubscription {
  id: string
  appId: string
  appNom: string
  clientId?: string
  clientNom: string
  clientEmail?: string
  userUid?: string         // UID TC Connect — pour contrôle d'accès
  prix?: number            // tarif au moment de la commande (apps payantes)
  statut: StoreSubStatut
  dateDebut: Timestamp
  dateFin?: Timestamp | null
  factureId?: string
  factureNumber?: string
  notes?: string
  limites?: Record<string, number>
  nextPaymentDate?: Timestamp | null   // prochaine échéance de paiement (apps payantes)
  lastPaymentAt?: Timestamp | null      // dernier paiement validé
  archivedAt?: Timestamp | null         // date d'archivage (abonnement terminé/arrêté)
  dataCleanedAt?: Timestamp | null      // date de purge des données de l'utilisateur (après archivage)
  events?: StoreSubEvent[]              // historique complet (demande, validation, ...)
  createdBy: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}

// ─── App « Sarah & Ted » : à voir, à faire, scores ────────────────────────────────

/** Champs communs aux trois listes : partage et traçabilité */
interface DuoBase {
  id: string
  /** UID des personnes qui partagent la liste (patron de `Bebe.members`) */
  members: string[]
  createdBy: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}

/** Document Firestore : duo_films/{id} — films et séries à voir ou déjà vus */
export interface DuoFilm extends DuoBase {
  /** « Film » ou « Série » */
  type: string
  nom: string
  /** Netflix, Canal +, Autre… */
  plateforme?: string
  /** Action, Thriller, Comédie… */
  categorie?: string
  /** Note de 1 à 5 (l'ancienne app notait en étoiles) */
  note?: number
  vu?: boolean
  /** Date de sortie annoncée — sert à repérer ce qui n'est pas encore disponible */
  dateSortie?: Timestamp
  /** Saison ou partie concernée, pour les séries */
  saison?: string
  infos?: string
}

/** Document Firestore : duo_activites/{id} — endroits et sorties */
export interface DuoActivite extends DuoBase {
  nom: string
  /** Restaurant, Bar, Lieu, Parc, Vacances, Aire d'autoroute, Logement… */
  type?: string
  /** Ville ou région */
  zone?: string
  /** Coordonnées « lat, lng » */
  gps?: string
  fait?: boolean
  note?: number
  /** « A faire absolument » / « A revoir » / « A ne pas faire » */
  priorite?: string
  /** Qui l'a recommandé — souvent la raison pour laquelle on y va */
  conseillePar?: string
  lien?: string
  /** 🟢 Abordable → 🔴 Exorbitant */
  gammePrix?: string
  infos?: string
}

/** Un tour de jeu : le score de chaque joueur sur ce tour */
export interface DuoTour {
  scores: { joueur: string; points: number }[]
}

/**
 * Document Firestore : duo_parties/{id}
 *
 * Les tours vivent DANS le document : une partie fait quelques dizaines de
 * lignes, très loin de la limite d'un document Firestore. L'ancienne app
 * plafonnait à 15 joueurs faute de sous-table — ici, aucune limite.
 */
export interface DuoPartie extends DuoBase {
  /** Uno, SkyJo, 6 qui prend… */
  jeu: string
  date?: Timestamp
  /** Noms libres : on joue avec des gens qui n'ont pas de compte */
  joueurs: string[]
  tours: DuoTour[]
  /** Au SkyJo le plus PETIT score gagne — l'inverse de la plupart des jeux */
  scoreBasGagne?: boolean
  termine?: boolean
}

// ─── Commandes au bar ─────────────────────────────────────────────────────────

/**
 * Une ligne de commande : une boisson, pour une personne.
 *
 * On garde UNE LIGNE PAR PERSONNE plutôt qu'une ligne « 4 × blonde » : c'est ce
 * qui permet à la fois de dire au barman « 4 blondes » (en regroupant) ET de
 * savoir qui doit combien (en additionnant par personne). L'inverse est
 * impossible — un total agrégé ne se redécoupe pas.
 */
export interface LigneCommande {
  id: string
  boisson: string
  /** Prix unitaire, facultatif : on ne connaît pas toujours la carte */
  prix?: number
  quantite: number
  /** Prénom de la personne concernée ; vide = pour la table */
  pour?: string
  /** Déjà servie — utile quand le bar apporte en plusieurs fois */
  servie?: boolean
}

/**
 * Document Firestore : bar_commandes/{id}
 * Une tournée au bar : qui boit quoi, ce qu'on dit au comptoir, et qui paie quoi.
 */
export interface Commande {
  id: string
  members: string[]
  createdBy: string
  createdAt: Timestamp
  updatedAt?: Timestamp

  /** Nom du bar, ou intitulé de la soirée */
  lieu?: string
  date?: Timestamp
  /** Personnes présentes — sert à saisir vite et à répartir l'addition */
  participants: string[]
  lignes: LigneCommande[]
  /** Close = payée, on ne la modifie plus au quotidien */
  terminee?: boolean
  notes?: string
}

// ─── Catalogue de bières ──────────────────────────────────────────────────────

/**
 * Document Firestore : bieres/{id}
 *
 * Une bière = UNE fiche, et autant de DÉGUSTATIONS qu'on veut (sous-collection).
 * La même bière bue deux fois au même endroit n'est pas deux bières : c'est ce
 * que l'ancien tableur ne savait pas dire.
 *
 * Rien n'est stocké de ce qui se recalcule (moyenne, classement, compteurs) :
 * une valeur figée se périmerait au premier ajout.
 */
export interface Biere {
  id: string
  /** UID des personnes qui partagent ce catalogue (même patron que `Bebe.members`) */
  members: string[]
  createdBy: string
  createdAt: Timestamp

  nom: string
  /** Pression / Canette / Bock — cf. SERVICES */
  service?: string
  /** Blonde, Ambré, Blanche… — cf. TYPES_BIERE */
  type?: string
  /** IPA, Bière de soif, Pale Ale… — cf. TYPOLOGIES */
  typologie?: string
  /** Degré d'alcool (ex : 6.5) */
  degres?: number
  /** Amertume (IBU). Historiquement noté tantôt en IBU, tantôt sur une échelle 0-1. */
  ibu?: number
  /** Pays ou région d'origine */
  origine?: string
  updatedAt?: Timestamp
}

/**
 * Document Firestore : bieres/{biereId}/degustations/{id}
 *
 * Le CONTEXTE est ce qui rend une dégustation mémorable — le bar, la météo, le
 * moment. Tout y est facultatif : on note souvent la bière et l'avis, rarement
 * la température.
 */
export interface Degustation {
  id: string
  createdBy: string
  /** UID qui partagent cette dégustation (recopié depuis `Biere.members` à la
   *  création) — conditionne la lecture par la requête `collectionGroup`. */
  membersDeg?: string[]
  createdAt: Timestamp
  /** Absente sur les fiches reprises de l'ancien tableur : 115 bières sur 184 n'avaient pas de date */
  date?: Timestamp

  /**
   * Notes de 0 à 5 (pas de 0,5), **indexées par UID** et non par prénom : coder
   * « Sarah » et « Teddy » en dur rendrait l'app inutilisable par quelqu'un d'autre.
   */
  notes?: Record<string, number>
  /** L'avis en toutes lettres — le champ le plus rempli de l'ancienne base */
  analyse?: string

  /**
   * L'établissement seul (« De Garre », « Camping Le Cenic »).
   * ⚠️ L'ancienne app entassait bar et ville dans un seul champ séparé par « / »
   * pour pouvoir faire des statistiques ; ils sont désormais distincts.
   */
  lieu?: string
  /** La ville seule (« Bruges », « Pénestin ») — sert aux statistiques */
  ville?: string
  /** Coordonnées « lat, lng » si relevées */
  gps?: string
  /** Terrasse / Intérieur */
  contexte?: string
  /** Festival, week-end, soirée… */
  evenement?: string
  /** Emoji météo (☀️ 🌧️ …) */
  meteo?: string
  /** Ressenti : 🥶 / 😎 / 🥵 */
  ressenti?: string
  /** Température en °C */
  temperature?: number
  /** URLs Firebase Storage */
  photos?: string[]
}

// ─── Suivi Bébé ───────────────────────────────────────────────────────────────

/** Document Firestore : babies/{babyId} */
export interface Bebe {
  id: string
  name: string
  birthDate: Timestamp
  members: string[]
  createdBy: string
  createdAt: Timestamp
  /** Photo du bébé (URL Firebase Storage) */
  photoUrl?: string
  /** Sommeil en cours — défini au "Start", supprimé au "Réveillé !" */
  activeSleep?: { startTime: Timestamp } | null

  // ── Arrivée du bébé (faire-part) ──────────────────────────────────────────
  /** Sexe — sert à accorder les messages ({ne} → né/née) */
  sex?: 'boy' | 'girl'
  /** Poids de naissance en grammes (ex : 3450) */
  birthWeightG?: number
  /** Taille de naissance en cm (ex : 50) */
  birthHeightCm?: number
  /** Périmètre crânien de naissance en cm (ex : 35) */
  birthHeadCm?: number
  /** Heure de naissance "HH:MM" */
  birthTime?: string
  /** Modèles de message d'annonce, assignables aux contacts */
  arrivalTemplates?: ArrivalTemplate[]

  /** Valeurs pré-sélectionnées dans les modales de saisie (propres à ce bébé) */
  defauts?: BebeDefauts
  /** Bornes de la journée du bébé (sépare siestes et nuit) */
  journee?: BebeJournee
}

/**
 * Bornes de la journée du bébé, en « HH:MM ».
 *
 * Sert à deux choses que minuit ne sait pas faire :
 *  1. classer un sommeil en SIESTE ou en NUIT selon son heure de début ;
 *  2. rattacher une nuit à la bonne journée — une nuit finie à 6 h appartient
 *     à la veille, alors qu'un découpage à minuit la comptait le lendemain.
 */
export interface BebeJournee {
  /** Heure de réveil habituelle, ex. « 07:00 » */
  debut: string
  /** Heure de coucher habituelle, ex. « 20:00 » */
  fin: string
}

/** Type d'alimentation d'un événement « biberon » */
export type BebeBottleKind = 'biberon' | 'sein_g' | 'sein_d' | 'tire_lait'
/** Contenu d'une couche */
export type BebeDiaperKind = 'seche' | 'urine' | 'selles' | 'mixte'

/**
 * Valeurs pré-cochées à l'ouverture des modales de saisie, réglées PAR BÉBÉ :
 * un foyer au tire-lait ne saisit pas la même chose qu'un foyer au biberon, et
 * ces gestes se répètent 8 fois par jour. Absent = repli sur les valeurs
 * historiques (biberon / 120 ml / urine).
 */
export interface BebeDefauts {
  bottleKind?: BebeBottleKind
  /** Quantité en ml (biberon / tire-lait) */
  bottleAmount?: number
  /** Durée en minutes (tétée au sein) */
  bottleDurationMin?: number
  diaperKind?: BebeDiaperKind
}

/** Modèle de message d'annonce de naissance (stocké sur le doc bébé) */
export interface ArrivalTemplate {
  id: string
  label: string
  /** Corps avec variables : {prenom} {poids} {taille} {date} {heure} {ne} {sexe} */
  body: string
}

/** Document Firestore : babies/{babyId}/contacts/{contactId} */
export interface BebeContact {
  id: string
  name: string
  /** Indicatif pays, ex : "+33" */
  indicatif: string
  telephone: string
  /** Modèle de message assigné (id d'un ArrivalTemplate) */
  templateId?: string
  createdAt: Timestamp
  /** Date d'envoi du message (null/absent = pas encore envoyé) */
  sentAt?: Timestamp | null
  /** Canal utilisé pour l'envoi */
  sentVia?: 'sms' | 'whatsapp' | null
}

/**
 * `growth` = une mesure (poids / taille / périmètre crânien) relevée à une date, alimente les courbes.
 * `bath` = un bain. `temp` = une prise de température. `vaccine` = un vaccin administré.
 * `pump` = une séance de TIRAGE au tire-lait : c'est un acte de la mère, distinct
 * du repas — le lait recueilli est donné plus tard au biberon, et compter les
 * deux comme des repas doublerait les volumes.
 * `waste` = du lait maternel JETÉ (périmé, reste de biberon non terminé) : sort
 * de la réserve sans avoir été bu. Ne compte pas comme un repas.
 * Tous les types acceptent en plus une observation libre dans `data.note`.
 */
export type BebeEventType =
  | 'bottle' | 'diaper' | 'sleep' | 'meds' | 'growth' | 'bath' | 'temp' | 'vaccine' | 'pump' | 'waste'

/** Document Firestore : babies/{babyId}/events/{eventId} */
export interface BebeEvent {
  id: string
  type: BebeEventType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  timestamp: Timestamp
  createdBy: string
}

/** Document Firestore : bebe_invites/{token} — lien d'invitation d'un co-parent.
 *  L'id du document EST le token (le secret = connaître l'id). */
export interface BebeInvite {
  id: string          // = token
  babyId: string
  babyName: string    // dénormalisé : affiché sur la page d'invitation (anonyme)
  createdBy: string   // uid de l'inviteur
  createdByName: string
  createdAt: Timestamp
  expiresAt: Timestamp
  usedAt?: Timestamp  // posé au premier usage (lien à usage unique)
  usedBy?: string
}

/** Membre d'un bébé, résolu côté serveur pour l'écran de partage. */
export interface BebeMember {
  uid: string
  nom: string
  prenom: string
  email: string
  isCreator: boolean
}

// ─── CheckConnect (listes / checklists) ────────────────────────────────────────

export type TripType =
  | 'vacances'
  | 'hotel' | 'camping' | 'airbnb' | 'roadtrip' | 'cruise'
  | 'ski' | 'city' | 'beach'
  | 'shopping' | 'event' | 'home' | 'work' | 'sport'
  | 'other'
  | (string & {})

export type TripRole = 'owner' | 'member'
export type TripPermission = 'view' | 'check' | 'edit'  // niveaux d'accès des liens de partage publics
export type TripMemberPermission = 'admin' | 'editor' | 'contributor' | 'viewer'

export interface TripAttachment {
  id: string
  type: 'link' | 'photo' | 'file'
  url: string
  name?: string
  mimeType?: string
}

export interface InviteLink {
  id: string          // = token (Firestore doc id)
  tripId: string
  permission: TripPermission
  label?: string
  inviteEmail?: string   // email pré-renseigné (partage par email)
  nom?: string           // NOM pré-renseigné
  prenom?: string        // prénom pré-renseigné
  createdAt: unknown     // Timestamp côté client, { _seconds } côté Admin
  createdBy: string
}

/** Membre d'une liste CheckConnect */
export interface TripMember {
  uid: string         // uid du compte, ou "guest:<token>" pour un invité sans compte
  role: TripRole
  permission?: TripMemberPermission
  checkMode?: 'all' | 'assigned'
  isGuest?: boolean   // invité par email, sans compte TC Connect (encore)
  nom?: string
  prenom?: string
  email?: string
  photoUrl?: string   // photo de profil TC Connect (dénormalisée)
}

export interface TripItem {
  id: string
  name: string
  qtyNeeded: number              // quantité fixe nécessaire
  qtyReady: number               // quantité déjà prête
  multiplier: number             // si > 0 : qtyEffective = ceil(multiplier × nbJours)
  note?: string
  assigneeId?: string | null     // uid du membre responsable
  dueDate?: string | null        // date limite ISO (YYYY-MM-DD)
  attachments?: TripAttachment[]
  position: number
}

export interface TripSection {
  id: string
  title: string
  position: number
  items: TripItem[]
}

/** Document Firestore : trips/{tripId} */
export interface Trip {
  id: string
  name: string
  type: TripType
  icon: string
  color: string
  dateFrom?: Timestamp | null
  dateTo?: Timestamp | null
  isTemplate: boolean
  archived?: boolean
  favoritedBy?: string[]         // UIDs des membres qui ont mis en favori
  ownerId: string
  memberIds: string[]
  members: TripMember[]
  sections: TripSection[]
  createdAt: Timestamp
  updatedAt?: Timestamp
}

/* ------------------------------------------------------------------ */
/* Mailing — prospection par corps de métier (Enezo)                   */
/* ------------------------------------------------------------------ */

/**
 * Une section (thème) d'un kit métier.
 * Remplace les colonnes AppSheet « Détails de cette partie (1..6) » : ici une
 * ligne ordonnée par `ordre`, sans plafond au nombre de thèmes.
 */
export interface MailingSection {
  id: string
  ordre: number
  theme: string                  // titre du thème (mail + brochure)
  problemeMail: string           // 💢 accroche mail
  solutionMail: string           // 👉 accroche mail
  problemesBrochure: string[]    // colonne gauche de la brochure
  solutionsBrochure: string[]    // colonne droite de la brochure
  afficher: boolean
  important: boolean             // priorise la section dans la sélection du mail
}

/** Document Firestore : mailing_metiers/{id} — le « kit de campagne » d'un métier */
export interface MailingMetier {
  id: string
  userId: string
  metier: string                 // « Menuiserie », « Plomberie », …
  problematiques: string         // phrase d'accroche insérée dans l'intro du mail
  objet: string                  // objet du mail
  sections: MailingSection[]
  nbThemesMail?: number          // nb de thèmes gardés dans le mail (défaut 3)
  /** Codes NAF du métier (ex. « 43.22A,43.22B ») — désambiguïsent la recherche SIRET. */
  codesNaf?: string
  /**
   * ── Mail court (premier contact) ──────────────────────────────────────────
   * Format retenu en juillet 2026 : une scène vécue, des exemples présentés
   * comme des illustrations, une question ouverte. Il remplace les 3 thèmes
   * problème/solution, trop longs et trop « catalogue » pour un contact froid.
   *
   * Les trois champs vont ENSEMBLE : le mail court n'est produit que s'ils sont
   * tous les trois remplis, sinon le kit sort l'ancien format. C'est ce qui
   * permet de migrer métier par métier sans rien casser.
   */
  mailScene?: string
  mailExemples?: string
  mailQuestion?: string
  /** Brochure PDF stockée (Storage) — évite de la régénérer à chaque consultation. */
  brochureUrl?: string
  brochureGenereeAt?: Timestamp
  actif?: boolean
  createdAt: Timestamp
  updatedAt?: Timestamp
}

export type ProspectStatut =
  | 'a_contacter'
  | 'envoye'
  | 'relance'
  | 'repondu'
  | 'interesse'
  | 'converti'
  | 'pas_interesse'
  | 'a_un_logiciel'
  | 'email_manquant'
  | 'oppose'
  | 'bounce'
  /** Société disparue (radiée, liquidée, reprise sous un autre nom). */
  | 'cessee'

/**
 * Document Firestore : prospects/{id}
 * Contact FROID, volontairement distinct de `Client` : on ne pollue pas la base
 * client (linkedUserId, espace client, facturation) avec des listes importées.
 * Un prospect est promu en `Client` quand il répond positivement.
 */
/**
 * Surcharges du mail court pour UN prospect. Mêmes blocs que le kit métier
 * (`MailingMetier.mailScene` / `mailExemples` / `mailQuestion` / `objet`) : on
 * réécrit le contenu, jamais la mise en forme — le HTML reste produit par le
 * moteur, qui garantit un rendu correct sous Outlook.
 */
export interface MailPerso {
  objet?: string
  scene?: string
  exemples?: string
  question?: string
}

/**
 * Une adresse de contact chez le prospect : à qui elle appartient, et à quel
 * titre. Savoir qu'on écrit au patron ou à l'accueil change ce qu'on écrit.
 */
export interface ProspectContact {
  email: string
  /** Identifiant d'un rôle du catalogue `ROLES_CONTACT` (lib/mailingModel) */
  role?: string
  nom?: string
}

export interface Prospect {
  id: string
  userId: string
  metierId?: string
  metier?: string
  societe: string
  email: string
  emailNormalise: string         // clé de dédup + de contrôle d'opposition
  /** Rôle de la personne derrière l'adresse principale (id de ROLES_CONTACT) */
  emailRole?: string
  /** Nom de la personne derrière l'adresse principale */
  emailNom?: string
  /**
   * Contacts SUPPLÉMENTAIRES de la même société (ex. le patron en plus de
   * l'adresse générique). Le mail leur est envoyé en même temps, dans UN SEUL
   * message — ce n'est donc pas un second envoi.
   * `email` reste l'adresse principale : c'est elle qui sert de clé de dédup.
   */
  contactsSupplementaires?: ProspectContact[]
  domaine?: string
  telephone?: string
  codePostal?: string
  ville?: string
  /** (legacy) Provenance de la donnée — champ retiré de la saisie, encore lu pour les prospects antérieurs. */
  origine?: string
  // Enrichissement SIRET (API publique « Recherche d'entreprises »)
  /** Nom du logiciel déjà en place — renseigné avec le statut 'a_un_logiciel'. */
  logicielActuel?: string
  /**
   * Sait-on si l'entreprise a un logiciel de gestion ? true = oui, false = non
   * (bon signe : pas de concurrent en place), undefined = on ne sait pas (rien
   * n'est affiché). Distinct de `logicielActuel`, qui n'est que le NOM quand connu.
   */
  aLogiciel?: boolean
  /**
   * Y a-t-il une personne DÉDIÉE à l'administratif/gestion/planning ? true = oui,
   * false = non (le dirigeant gère tout), undefined = on ne sait pas. Signal fort :
   * admin dédié + logiciel = viser une offre meilleure ; admin dédié SANS logiciel
   * = gros gain de temps « servi sur un plateau ».
   */
  responsableAdmin?: boolean
  // ── Étude préalable (résultat du prompt IA, collé dans l'app) ──────────────
  /** Nom du dirigeant à qui écrire, issu de l'étude. */
  dirigeant?: string
  /** Âge ou année de naissance du dirigeant si trouvé (texte libre : « 43 ans », « 1981 »). */
  dirigeantAge?: string
  /**
   * Profil générationnel du dirigeant : true = jeune (< ~45 ans, a priori plus
   * réceptif au numérique) ; false = senior (> ~55 ans, souvent fin de carrière,
   * moins outillé) ; undefined = inconnu. Signal d'appétence à un logiciel.
   */
  dirigeantJeune?: boolean
  /** Phrase de personnalisation issue de l'étude — pré-remplit le composeur. */
  personnalisation?: string
  /**
   * Mail RÉÉCRIT pour ce prospect précis : les blocs saisis ici remplacent ceux
   * du kit métier au moment du rendu, pour lui seul. Sert à exploiter l'étude
   * (dirigeant, effectif, logiciel en place…) au-delà de la seule ligne de
   * personnalisation. Un bloc vide ⇒ on retombe sur le kit.
   */
  mailPerso?: MailPerso
  /** Date de la dernière adaptation du mail */
  mailPersoAt?: Timestamp
  /**
   * Angle de message recommandé par l'étude : 'surcharge' (le dirigeant fait tout,
   * angle par défaut) ou 'circulation' (bureau + planificateur dédié → problème de
   * circulation de l'info), 'inconnu' si l'étude n'a pas tranché.
   */
  angle?: 'surcharge' | 'circulation' | 'inconnu'
  /**
   * TOUS les angles qui collent à cette entreprise, du plus au moins pertinent
   * (identifiants du catalogue `ANGLES`, lib/mailingModel). Remplace `angle` :
   * une entreprise a souvent plusieurs prises, et chacune est une cartouche pour
   * le premier mail ou une relance. `anglesDe()` gère le repli sur `angle`.
   */
  angles?: string[]
  /**
   * Nom du groupe / holding auquel appartient l'entreprise, si l'étude en révèle un.
   * Sert à repérer deux prospects du MÊME groupe (souvent sur des kits métier
   * différents) — inutile de contacter les deux. Recoupé aussi par le `dirigeant`.
   */
  groupe?: string
  /** Nombre de salariés RÉEL trouvé par l'étude (texte libre : « 8 », « ~12 »…). */
  effectifReel?: string
  /** En plein développement (recrutement, CA en hausse, rachat/reprise récente…) — signal fort. */
  enDeveloppement?: boolean
  /** État du site web selon l'étude : 'pro' (propre), 'bancal' (à moitié fait/à l'abandon), 'aucun'. */
  siteEtat?: 'pro' | 'bancal' | 'aucun'
  /** Fiche factuelle compilée depuis l'étude (effectif réel, organisation, site, avis…). */
  etudeResume?: string
  /** Date de la dernière étude enregistrée sur la fiche. */
  etudeAt?: Timestamp
  /**
   * Un prompt de recherche a déjà été LANCÉ sur ce prospect (copié pour l'IA),
   * même si le résultat n'a pas encore été collé. Distinct de `etudeAt` (résultat
   * enregistré) : sert à ne pas relancer deux fois la même recherche.
   */
  promptLanceAt?: Timestamp
  siret?: string
  siren?: string
  /** Code INSEE de tranche d'effectif — jamais un nombre exact (cf. lib/sirene.ts). */
  effectifCode?: string
  effectifAnnee?: number
  /** true si l'effectif provient de l'entreprise faute de donnée d'établissement. */
  effectifDeLEntreprise?: boolean
  activiteNaf?: string
  /**
   * État administratif au registre, tel que renvoyé par l'API. 'A' = active.
   * Fermée/cessée = 'F' (code de l'ÉTABLISSEMENT, celui que renvoie l'API en
   * priorité) OU 'C' (code de l'ENTREPRISE, en repli) — tester les deux via
   * `estCessee()`. À ne pas confondre avec le STATUT `cessee`, qui est un
   * constat de l'utilisateur : ici c'est la donnée officielle.
   */
  etatEntreprise?: string
  enrichiAt?: Timestamp
  statut: ProspectStatut
  optoutToken: string            // jeton du lien de désinscription
  nbEnvois?: number
  dernierEnvoiAt?: Timestamp | null
  prochaineRelanceAt?: Timestamp | null
  clientId?: string              // rempli à la promotion vers le CRM
  /**
   * « Mes prioritaires » : marqué À LA MAIN comme à contacter EN PREMIER. C'est une
   * liste SÛRE, choisie par l'utilisateur, TOTALEMENT distincte du score automatique
   * (`evaluerPrioriteAuto`, une simple suggestion). Les deux coexistent sans se
   * mélanger. Voir `estPrioritaireManuel` / `estPrioritaireAuto`.
   */
  prioritaireManuel?: boolean
  /** Fiches écartées à la main comme « pas la même société » — ne plus les proposer. */
  doublonsIgnores?: string[]
  notes?: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}

/**
 * Document Firestore : mailing_envois/{id}
 * Snapshot FIGÉ du message réellement envoyé. Corrige le défaut du système
 * AppSheet, où le corps était recalculé à la volée depuis le kit courant : les
 * envois passés étaient donc réécrits à chaque modification du template.
 */
export interface MailingEnvoi {
  id: string
  userId: string
  prospectId: string
  societe: string
  metier?: string
  type: 'initial' | 'relance'
  objet: string
  corpsHtml: string              // figé, jamais recalculé
  /** Adresses réellement mises en destinataire (absent sur les envois d'avant le multi-adresses) */
  destinataires?: string[]
  personnalisation: string
  canal: 'brouillon' | 'auto'
  envoyeAt: Timestamp
}

/**
 * Document Firestore : mailing_optout/{safeId(email)}
 * Registre d'opposition GLOBAL, hors de `prospects` : il survit à la suppression
 * d'un prospect comme au ré-import d'une liste. Une opposition ne peut pas être
 * annulée par un import.
 */
export interface MailingOptout {
  id: string
  email: string
  origine: 'lien' | 'manuel' | 'bounce'
  prospectId?: string
  createdAt: Timestamp
}

/**
 * Document Firestore : mailing_evenements/{id}
 * Journal du parcours d'un prospect — ce que faisait `DetailsMailing` sur
 * AppSheet. Sans lui, `Prospect.statut` est écrasé à chaque changement : on perd
 * la date de la réponse, le délai depuis l'envoi et ce que le contact a dit.
 * Écrit une fois, jamais modifié (un journal réinscriptible ne vaut rien).
 */
export interface MailingEvenement {
  id: string
  userId: string
  prospectId: string
  societe: string
  metier?: string
  type: 'statut' | 'envoi' | 'note' | 'promotion' | 'annulation' | 'desinscription'
  statutAvant?: ProspectStatut
  statutApres?: ProspectStatut
  observations?: string
  /** Jours écoulés depuis le dernier envoi — donne le délai de réponse. */
  delaiDepuisEnvoi?: number
  createdAt: Timestamp
}

/**
 * Document Firestore : mailing_logiciels/{id}
 * Référentiel des logiciels rencontrés chez les prospects. Une liste fermée
 * plutôt qu'une saisie libre : « Batappli », « batappli » et « BatAppli »
 * compteraient sinon comme trois outils distincts et fausseraient les stats.
 * Prévu pour accueillir coût et fonctionnalités, afin de se positionner face
 * à chaque concurrent.
 */
export interface MailingLogiciel {
  id: string
  userId: string
  nom: string
  /** Ordre de grandeur du coût annoncé par les prospects (texte libre). */
  cout?: string
  /** Ce que couvre l'outil, tel que rapporté. */
  fonctionnalites?: string
  createdAt: Timestamp
}

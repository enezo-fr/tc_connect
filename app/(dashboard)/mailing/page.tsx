"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  listenMetiers, listenProspects, listenOptouts, listenEvenements, listenLogiciels,
  updateProspect, deleteProspect, ajouterOptout, journaliser,
  modifierNote, supprimerNote, ajouterLogiciel, supprimerLogiciel, detacherDuClient,
  annulerDernierEnvoi, annulerEnrichissement, definirPrioriteManuelle,
} from "@/lib/mailingService";
import PromotionModal from "@/components/mailing/PromotionModal";
import EtudeModal from "@/components/mailing/EtudeModal";
import AdapterMailModal from "@/components/mailing/AdapterMailModal";
import { estMailCourt } from "@/lib/mailingRender";
import FusionModal from "@/components/mailing/FusionModal";
import AutoTextarea from "@/components/ui/AutoTextarea";
import {
  QUOTA_JOUR, peutContacter, isEmailGenerique, STATUT_LABEL, STATUT_STYLE,
  aRepondu, contacteDepuis, estPrioritaireManuel, estPrioritaireAuto, evaluerPrioriteAuto,
  ANGLES, anglesDe, angleLabel,
} from "@/lib/mailingModel";
import Modal from "@/components/ui/Modal";
import {
  GROUPES_EFFECTIF, estCessee, groupeEffectif, libelleEffectif, type GroupeEffectif,
} from "@/lib/sirene";
import { departementDuCp } from "@/lib/territoires";
import ImportModal from "@/components/mailing/ImportModal";
import ProspectModal from "@/components/mailing/ProspectModal";
import StatutModal from "@/components/mailing/StatutModal";
import EnrichirModal from "@/components/mailing/EnrichirModal";
import AnnuaireModal from "@/components/mailing/AnnuaireModal";
import SuiviTab from "@/components/mailing/SuiviTab";
import FiltreRayon, { useRayon } from "@/components/mailing/FiltreRayon";
import DoublonsModal from "@/components/mailing/DoublonsModal";
import { trouverDoublons } from "@/lib/mailingDoublons";
import KitEditor from "@/components/mailing/KitEditor";
import Composeur from "@/components/mailing/Composeur";
import type {
  MailingEvenement, MailingLogiciel, MailingMetier, MailingOptout, Prospect, ProspectStatut,
} from "@/types";
import {
  ArrowUpTrayIcon, PaperAirplaneIcon, RectangleStackIcon, UsersIcon, TrashIcon, PlusIcon,
  PencilIcon, PencilSquareIcon, ClockIcon, ChartBarIcon, ChatBubbleLeftEllipsisIcon, BuildingOffice2Icon,
  ArrowUturnLeftIcon, Square2StackIcon, StarIcon, SparklesIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";

type Onglet = "prospects" | "kits" | "composer" | "suivi";

/** Repères visuels du journal : quatre natures d'événement, quatre couleurs. */
const EVT_LABEL: Record<MailingEvenement["type"], string> = {
  envoi: "ENVOI",
  statut: "STATUT",
  note: "NOTE",
  promotion: "CLIENT",
  annulation: "ANNULÉ",
  desinscription: "DÉSINSCRIT",
};

function Chip({
  actif, onClick, label, nombre, attenue,
}: {
  actif: boolean;
  onClick: () => void;
  label: string;
  nombre?: number;
  /** Catégorie vide : visible mais en retrait. */
  attenue?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
        actif
          ? "bg-blue-600 text-white"
          : attenue
            ? "border border-dashed text-gray-400 hover:bg-gray-50"
            : "border text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
      {typeof nombre === "number" && (
        <span className={`ml-1.5 ${actif ? "text-blue-100" : "text-gray-400"}`}>{nombre}</span>
      )}
    </button>
  );
}

const EVT_STYLE: Record<MailingEvenement["type"], string> = {
  envoi: "bg-blue-100 text-blue-700",
  statut: "bg-indigo-100 text-indigo-700",
  note: "bg-amber-100 text-amber-800",
  promotion: "bg-green-100 text-green-700",
  annulation: "bg-gray-200 text-gray-600",
  desinscription: "bg-red-100 text-red-700",
};

/** État « logiciel de gestion ? » d'un prospect, pour le badge et le filtre. */
function etatLogiciel(p: Prospect): "oui" | "non" | "inconnu" {
  if (p.aLogiciel === false) return "non";
  if (p.aLogiciel === true || p.logicielActuel) return "oui";
  return "inconnu";
}

/** Où en est la recherche/étude d'un prospect (prioritaire : étudié > lancé > rien). */
function etatEtude(p: Prospect): "etudie" | "lance" | "rien" {
  if (
    p.etudeAt || p.dirigeant || p.personnalisation || p.etudeResume ||
    p.aLogiciel !== undefined || p.responsableAdmin !== undefined ||
    p.enDeveloppement !== undefined || p.siteEtat || p.effectifReel || anglesDe(p).length > 0 || p.groupe
  ) return "etudie";
  if (p.promptLanceAt) return "lance";
  return "rien";
}

/**
 * Compteurs des onglets, mémorisés d'une visite à l'autre.
 * Les listeners Firestore mettent un instant à répondre : sans ce cache, les
 * badges apparaîtraient vides puis sauteraient à leur valeur. On affiche donc
 * la dernière valeur connue jusqu'à l'arrivée des données réelles.
 */
type Compteurs = { prospects: number; kits: number; contactables: number; evenements: number };

/**
 * Palette des badges d'une ligne prospect.
 *
 * Une ligne en porte jusqu'à une douzaine : si deux signaux partagent la même
 * teinte, l'œil ne distingue plus rien et la ligne devient une bouillie pastel.
 * Règle tenue ici : **une teinte = un signal**, aucune réutilisation.
 * Les signaux FORTS (à qui écrire, quoi écrire, doublon de groupe) portent en
 * plus une bordure et un texte plus soutenu, pour ressortir du reste.
 */
const BADGE = {
  base: "px-2 py-0.5 rounded-full text-[11px]",
  effectifInsee: "bg-slate-100 text-slate-700",
  effectifReel: "bg-cyan-50 text-cyan-700",
  logiciel: "bg-purple-50 text-purple-700",
  sansLogiciel: "bg-lime-50 text-lime-700",
  adminDedie: "bg-indigo-100 text-indigo-800 font-medium border border-indigo-200",
  enDev: "bg-emerald-100 text-emerald-700 font-medium",
  siteARefaire: "bg-orange-100 text-orange-700 font-medium",
  sansSite: "bg-sky-50 text-sky-700",
  mailAdapte: "bg-violet-100 text-violet-800 font-medium border border-violet-200",
  angle: "bg-blue-50 text-blue-700",
  cessee: "bg-red-100 text-red-700",
  etudie: "bg-fuchsia-100 text-fuchsia-700 font-medium",
  promptLance: "bg-amber-100 text-amber-700",
  dirigeant: "bg-pink-100 text-pink-800 font-medium border border-pink-200",
  gerantJeune: "bg-green-100 text-green-700",
  gerantSenior: "bg-stone-100 text-stone-600",
  groupe: "bg-yellow-100 text-yellow-800 font-medium",
  generique: "bg-gray-100 text-gray-500",
} as const;

const cleCompteurs = (uid: string) => `mailing:compteurs:${uid}`;

/**
 * Renvoie la chaîne BRUTE du stockage, pas l'objet analysé.
 * `useSyncExternalStore` compare les instantanés par identité : rendre un objet
 * fraîchement analysé à chaque appel produit une nouvelle référence à chaque
 * rendu, donc une boucle infinie. Une chaîne, elle, se compare par valeur.
 */
function lireCompteursBrut(uid: string): string | null {
  if (!uid || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(cleCompteurs(uid));
  } catch {
    return null;
  }
}

function fmtDateHeure(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function MailingPage() {
  const router = useRouter();
  const { currentUser, userProfile } = useAuth();
  const isAdmin = userProfile?.role_app === "Admin";

  const [onglet, setOnglet] = useState<Onglet>("prospects");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [metiers, setMetiers] = useState<MailingMetier[]>([]);
  const [optouts, setOptouts] = useState<Set<string>>(new Set());
  const [optoutDocs, setOptoutDocs] = useState<MailingOptout[]>([]);
  const [importOuvert, setImportOuvert] = useState(false);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [enrichOuvert, setEnrichOuvert] = useState(false);
  const [annuaireOuvert, setAnnuaireOuvert] = useState(false);
  const [doublonsOuvert, setDoublonsOuvert] = useState(false);
  /** Les listeners ont-ils répondu ? Distingue « vide » de « pas encore chargé ». */
  const [charge, setCharge] = useState(false);
  const [aEditer, setAEditer] = useState<Prospect | null>(null);
  const [aEtudier, setAEtudier] = useState<Prospect | null>(null);
  const [aAdapter, setAAdapter] = useState<{ prospect: Prospect; metier: MailingMetier } | null>(null);
  const [aFusionner, setAFusionner] = useState<Prospect[] | null>(null);
  const [evenements, setEvenements] = useState<MailingEvenement[]>([]);
  const [logiciels, setLogiciels] = useState<MailingLogiciel[]>([]);
  const [statutEnCours, setStatutEnCours] = useState<
    { prospect: Prospect; cible?: ProspectStatut } | null
  >(null);
  const [historique, setHistorique] = useState<string | null>(null);
  const [noteEnEdition, setNoteEnEdition] = useState<{ id: string; texte: string } | null>(null);
  const [noteASupprimer, setNoteASupprimer] = useState<string | null>(null);
  const [filtreStatut, setFiltreStatut] = useState<ProspectStatut | "tous">("tous");
  const [filtreMetier, setFiltreMetier] = useState<string>("tous");
  const [recherche, setRecherche] = useState("");
  const [filtreRegion, setFiltreRegion] = useState<string>("tous");
  const [filtreDept, setFiltreDept] = useState<string>("tous");
  const [filtreEffectif, setFiltreEffectif] = useState<GroupeEffectif | "tous">("tous");
  const [filtreEtat, setFiltreEtat] = useState<"tous" | "actives" | "cessees">("tous");
  const [filtrePriorite, setFiltrePriorite] = useState<"tous" | "manuel" | "auto">("tous");
  const [filtreEmail, setFiltreEmail] = useState<"tous" | "avec" | "sans">("tous");
  const [filtreLogiciel, setFiltreLogiciel] = useState<"tous" | "oui" | "non" | "inconnu">("tous");
  const [filtreAdmin, setFiltreAdmin] = useState<"tous" | "oui" | "non">("tous");
  const [filtreDev, setFiltreDev] = useState<"tous" | "oui" | "non">("tous");
  const [filtreSite, setFiltreSite] = useState<"tous" | "pro" | "bancal" | "aucun">("tous");
  // « tous » ou l'identifiant d'un angle du catalogue (ANGLES)
  const [filtreAngle, setFiltreAngle] = useState<string>("tous");
  const [filtreLie, setFiltreLie] = useState(false);
  const [filtreMailPerso, setFiltreMailPerso] = useState(false);
  const [filtreEtude, setFiltreEtude] = useState<"tous" | "etudie" | "lance" | "rien">("tous");
  const [filtreGerant, setFiltreGerant] = useState<"tous" | "jeune" | "senior">("tous");
  const [aSupprimer, setASupprimer] = useState<Prospect | null>(null);
  const [aDesenvoyer, setADesenvoyer] = useState<Prospect | null>(null);
  const [aDesenrichir, setADesenrichir] = useState<Prospect | null>(null);
  // Le mode sélection est OPT-IN : en lecture courante, des cases à cocher sur
  // chaque ligne ajoutent du bruit et invitent au clic accidentel.
  const [modeSelection, setModeSelection] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [actionLot, setActionLot] = useState<"statut" | "insee" | "supprimer" | "metier" | "groupe" | null>(null);
  const [statutLot, setStatutLot] = useState<ProspectStatut>("cessee");
  const [metierLot, setMetierLot] = useState<string>("");
  const [groupeLot, setGroupeLot] = useState<string>("");
  const [lotEnCours, setLotEnCours] = useState<{ fait: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile && !isAdmin) router.replace("/accueil");
  }, [userProfile, isAdmin, router]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const u1 = listenProspects(currentUser.uid, (p) => { setProspects(p); setCharge(true); });
    const u2 = listenMetiers(currentUser.uid, setMetiers);
    const u3 = listenOptouts((set, docs) => { setOptouts(set); setOptoutDocs(docs); });
    const u4 = listenEvenements(currentUser.uid, setEvenements);
    const u5 = listenLogiciels(currentUser.uid, setLogiciels);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [currentUser?.uid]);

  const notifier = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  /** Envois du jour : déduit des prospects (un envoi par prospect et par jour). */
  const envoyesAujourdhui = useMemo(() => {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    return prospects.filter(
      (p) => p.dernierEnvoiAt && p.dernierEnvoiAt.toDate() >= debut,
    ).length;
  }, [prospects]);

  /** Début de la période mesurée. Vide = tout l'historique, AppSheet compris. */
  const [depuis, setDepuis] = useState<string>("");
  useEffect(() => {
    setDepuis(window.localStorage.getItem("tc.mailing.depuis") ?? "");
  }, []);
  const dateDepuis = depuis ? new Date(`${depuis}T00:00:00`) : null;
  const majDepuis = (v: string) => {
    setDepuis(v);
    window.localStorage.setItem("tc.mailing.depuis", v);
  };

  const stats = useMemo(() => {
    // Cohorte : parmi ceux contactés DANS la période, combien ont répondu.
    // Mesurer les réponses sur l'ensemble de la base rapporterait les retours
    // d'aujourd'hui à des envois vieux de plusieurs années.
    const cohorte = prospects.filter((p) => contacteDepuis(p, dateDepuis));
    const repondus = cohorte.filter(aRepondu).length;
    return {
      total: prospects.length,
      aContacter: prospects.filter((p) => p.statut === "a_contacter").length,
      envoyes: cohorte.length,
      repondus,
      taux: cohorte.length ? Math.round((repondus / cohorte.length) * 100) : 0,
    };
  }, [prospects, dateDepuis]);

  const compteursVifs = useMemo<Compteurs>(
    () => ({
      prospects: prospects.length,
      kits: metiers.length,
      contactables: prospects.filter((p) => peutContacter(p, optouts).ok).length,
      evenements: evenements.length,
    }),
    [prospects, metiers, optouts, evenements],
  );

  // Instantané du navigateur : `useSyncExternalStore` fournit un rendu serveur
  // distinct, ce qui évite l'écart d'hydratation sans setState dans un effet.
  const cacheBrut = useSyncExternalStore(
    () => () => {},
    () => lireCompteursBrut(currentUser?.uid ?? ""),
    () => null,
  );

  // L'analyse est faite ici, une seule fois par valeur stockée.
  const cache = useMemo<Compteurs | null>(() => {
    if (!cacheBrut) return null;
    try {
      return JSON.parse(cacheBrut) as Compteurs;
    } catch {
      return null;
    }
  }, [cacheBrut]);

  const compteurs = charge ? compteursVifs : cache;

  // Écriture du cache : mise à jour d'un système externe, le rôle même d'un effet.
  useEffect(() => {
    if (!charge || !currentUser?.uid) return;
    try {
      window.localStorage.setItem(cleCompteurs(currentUser.uid), JSON.stringify(compteursVifs));
    } catch {
      /* quota plein ou stockage désactivé : les badges restent simplement vifs */
    }
  }, [charge, currentUser?.uid, compteursVifs]);

  /** Territoires réellement présents dans la liste, avec leur volume. */
  const territoires = useMemo(() => {
    const regions = new Map<string, number>();
    const depts = new Map<string, { nom: string; region: string; n: number }>();
    for (const p of prospects) {
      const d = departementDuCp(p.codePostal);
      if (!d) continue;
      regions.set(d.region, (regions.get(d.region) ?? 0) + 1);
      const e = depts.get(d.code) ?? { nom: d.nom, region: d.region, n: 0 };
      e.n++;
      depts.set(d.code, e);
    }
    return {
      regions: [...regions.entries()].sort((a, b) => b[1] - a[1]),
      depts: [...depts.entries()].sort((a, b) => b[1].n - a[1].n),
    };
  }, [prospects]);

  const rayon = useRayon(prospects);

  // Comptage seulement (les paires sont recalculées dans la modale) : la
  // détection est en O(n²) par code postal, inutile de la garder en mémoire ici.
  const nbDoublons = useMemo(
    () => trouverDoublons(prospects).filter((p) => !p.ignoree).length,
    [prospects],
  );

  /** Critères actifs — la recherche et le rayon comptent comme les pastilles. */
  const nbFiltresActifs =
    (filtreStatut !== "tous" ? 1 : 0) +
    (filtreMetier !== "tous" ? 1 : 0) +
    (filtreRegion !== "tous" ? 1 : 0) +
    (filtreDept !== "tous" ? 1 : 0) +
    (filtreEffectif !== "tous" ? 1 : 0) +
    (filtreEtat !== "tous" ? 1 : 0) +
    (filtrePriorite !== "tous" ? 1 : 0) +
    (filtreEmail !== "tous" ? 1 : 0) +
    (filtreLogiciel !== "tous" ? 1 : 0) +
    (filtreAdmin !== "tous" ? 1 : 0) +
    (filtreDev !== "tous" ? 1 : 0) +
    (filtreSite !== "tous" ? 1 : 0) +
    (filtreAngle !== "tous" ? 1 : 0) +
    (filtreLie ? 1 : 0) +
    (filtreMailPerso ? 1 : 0) +
    (filtreEtude !== "tous" ? 1 : 0) +
    (filtreGerant !== "tous" ? 1 : 0) +
    (rayon.rayon !== null ? 1 : 0) +
    (recherche.trim() ? 1 : 0);

  const reinitialiserFiltres = () => {
    setFiltreStatut("tous");
    setFiltreMetier("tous");
    setFiltreRegion("tous");
    setFiltreDept("tous");
    setFiltreEffectif("tous");
    setFiltreEtat("tous");
    setFiltrePriorite("tous");
    setFiltreEmail("tous");
    setFiltreLogiciel("tous");
    setFiltreAdmin("tous");
    setFiltreDev("tous");
    setFiltreSite("tous");
    setFiltreAngle("tous");
    setFiltreLie(false);
    setFiltreMailPerso(false);
    setFiltreEtude("tous");
    setFiltreGerant("tous");
    setRecherche("");
    // Le rayon est remis à « partout », mais le code postal de référence et les
    // communes déjà chargées restent : les recharger n'aurait aucun intérêt.
    rayon.setRayon(null);
  };

  // Prospects LIÉS : même dirigeant OU même groupe/holding (souvent sur des kits
  // métier différents) → inutile de contacter les deux. id → sociétés liées.
  // Calculé AVANT `listeFiltree` car le filtre « liés » s'appuie dessus.
  const liensGroupe = useMemo(() => {
    const norm = (s?: string) => (s ?? "").trim().toLowerCase();
    const parCle = new Map<string, Prospect[]>();
    const push = (cle: string, p: Prospect) => {
      const arr = parCle.get(cle);
      if (arr) arr.push(p); else parCle.set(cle, [p]);
    };
    for (const p of prospects) {
      const d = norm(p.dirigeant);
      if (d) push("d:" + d, p);
      const g = norm(p.groupe);
      if (g && g !== "aucun") push("g:" + g, p);
    }
    // id → prospects liés (dédupliqués par id : un lien par dirigeant ET par groupe
    // ne compte qu'une fois).
    const rel = new Map<string, Map<string, Prospect>>();
    for (const arr of parCle.values()) {
      if (arr.length < 2) continue;
      for (const p of arr) {
        const m = rel.get(p.id) ?? new Map<string, Prospect>();
        for (const o of arr) if (o.id !== p.id) m.set(o.id, o);
        rel.set(p.id, m);
      }
    }
    return rel;
  }, [prospects]);

  const listeFiltree = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const liste = prospects.filter((p) => {
      // « cessée » = état administratif 'C' au registre. L'état n'est connu que
      // pour les prospects enrichis : les autres ne sont ni actifs ni cessés.
      if (filtreEtat === "cessees" && !estCessee(p.etatEntreprise)) return false;
      if (filtreEtat === "actives" && estCessee(p.etatEntreprise)) return false;
      if (filtreStatut !== "tous" && p.statut !== filtreStatut) return false;
      if (filtreMetier !== "tous" && (p.metierId ?? "") !== filtreMetier) return false;
      const d = departementDuCp(p.codePostal);
      if (filtreRegion !== "tous" && d?.region !== filtreRegion) return false;
      if (filtreDept !== "tous" && d?.code !== filtreDept) return false;
      if (filtreEffectif !== "tous" && groupeEffectif(p.effectifCode) !== filtreEffectif) return false;
      if (filtrePriorite === "manuel" && !estPrioritaireManuel(p)) return false;
      if (filtrePriorite === "auto" && !estPrioritaireAuto(p, rayon.distance(p))) return false;
      const aEmail = !!p.email?.trim();
      if (filtreEmail === "avec" && !aEmail) return false;
      if (filtreEmail === "sans" && aEmail) return false;
      if (filtreLogiciel !== "tous" && etatLogiciel(p) !== filtreLogiciel) return false;
      if (filtreAdmin === "oui" && p.responsableAdmin !== true) return false;
      if (filtreAdmin === "non" && p.responsableAdmin !== false) return false;
      if (filtreDev === "oui" && p.enDeveloppement !== true) return false;
      if (filtreDev === "non" && p.enDeveloppement !== false) return false;
      if (filtreSite !== "tous" && p.siteEtat !== filtreSite) return false;
      if (filtreAngle !== "tous" && !anglesDe(p).includes(filtreAngle)) return false;
      if (filtreLie && !liensGroupe.has(p.id)) return false;
      if (filtreMailPerso && !p.mailPerso) return false;
      if (filtreEtude !== "tous" && etatEtude(p) !== filtreEtude) return false;
      if (filtreGerant === "jeune" && p.dirigeantJeune !== true) return false;
      if (filtreGerant === "senior" && p.dirigeantJeune !== false) return false;
      if (!rayon.dansRayon(p)) return false;
      if (q && !`${p.societe} ${p.email} ${p.ville ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // Rayon actif = les plus proches d'abord : c'est l'ordre dans lequel Teddy
    // veut les traiter, pas l'ordre alphabétique.
    return rayon.rayon === null
      ? liste
      : [...liste].sort((a, b) => (rayon.distance(a) ?? 1e9) - (rayon.distance(b) ?? 1e9));
  }, [prospects, filtreStatut, filtreMetier, filtreRegion, filtreDept, filtreEffectif, filtreEtat, filtrePriorite, filtreEmail, filtreLogiciel, filtreAdmin, filtreDev, filtreSite, filtreAngle, filtreLie, filtreMailPerso, filtreEtude, filtreGerant, liensGroupe, recherche, rayon]);

  const basculerSelection = (id: string) => {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Étoile = « mes prioritaires » (marquage manuel, à contacter en premier).
  // Indépendante du score auto : elle ne fait que basculer MON marquage.
  const basculerPriorite = async (p: Prospect) => {
    try {
      await definirPrioriteManuelle(p.id, !estPrioritaireManuel(p));
    } catch {
      notifier("La priorité n'a pas pu être enregistrée.");
    }
  };

  const selectionnes = listeFiltree.filter((p) => selection.has(p.id));

  /**
   * Actions groupées. Séquentielles et non transactionnelles : sur un lot
   * interrompu, ce qui est fait est fait — c'est acceptable ici (chaque prospect
   * est indépendant) et ça évite une écriture par lot de 500 qui échouerait en bloc.
   */
  const executerLot = async () => {
    const cibles = [...selectionnes];
    setLotEnCours({ fait: 0, total: cibles.length });
    let fait = 0;
    for (const p of cibles) {
      try {
        if (actionLot === "statut") {
          // Passe par le même chemin qu'une modification unitaire : le journal
          // doit garder la trace de chaque transition, même en masse.
          await appliquerStatut(p, statutLot, "Modification groupée", "");
        } else if (actionLot === "insee") {
          await annulerEnrichissement(p);
        } else if (actionLot === "supprimer") {
          await deleteProspect(p.id);
        } else if (actionLot === "metier") {
          const m = metiers.find((k) => k.id === metierLot);
          await updateProspect(p.id, { metierId: metierLot, metier: m?.metier ?? "" });
        } else if (actionLot === "groupe") {
          // Groupe commun : le nom saisi, sinon dérivé de la 1re société sélectionnée.
          const nom = groupeLot.trim() || `Groupe ${cibles[0]?.societe ?? ""}`.trim();
          await updateProspect(p.id, { groupe: nom });
        }
      } catch {
        /* prospect ignoré : le lot continue */
      }
      fait++;
      setLotEnCours({ fait, total: cibles.length });
    }
    // Après un « Même groupe », proposer la fusion des sélectionnés de MÊME métier
    // (une holding avec 2 fiches du même métier = souvent un doublon à fusionner).
    let proposerFusion: Prospect[] | null = null;
    if (actionLot === "groupe") {
      const parMetier = new Map<string, Prospect[]>();
      for (const p of cibles) {
        if (!p.metierId) continue;
        const arr = parMetier.get(p.metierId);
        if (arr) arr.push(p); else parMetier.set(p.metierId, [p]);
      }
      proposerFusion = [...parMetier.values()].find((arr) => arr.length >= 2) ?? null;
    }

    setLotEnCours(null);
    setActionLot(null);
    setSelection(new Set());
    setGroupeLot(""); // le nom de groupe saisi ne doit pas rester d'un lot à l'autre
    notifier(`${fait} prospect(s) traité(s).`);
    if (proposerFusion) setAFusionner(proposerFusion);
  };

  const appliquerStatut = async (
    p: Prospect, statut: ProspectStatut, observations: string, logiciel: string,
  ) => {
    // Le nom du logiciel part aussi dans le journal : le champ courant peut
    // changer plus tard, l'événement garde ce qui était vrai ce jour-là.
    const noteLogiciel =
      statut === "a_un_logiciel" && logiciel ? `Logiciel en place : ${logiciel}` : "";
    const obs = [noteLogiciel, observations].filter(Boolean).join(" — ");
    // Journalisé AVANT la mise à jour : `journaliser` lit `dernierEnvoiAt` sur le
    // prospect pour figer le délai de réponse, et l'ancien statut pour la transition.
    await journaliser(p, {
      type: "statut",
      statutAvant: p.statut,
      statutApres: statut,
      observations: obs || undefined,
    });
    await updateProspect(p.id, {
      statut,
      ...(statut === "a_un_logiciel" ? { logicielActuel: logiciel } : {}),
    });
    // Une opposition doit rejoindre le registre global, sinon elle ne survit pas
    // à la suppression du prospect ni à un ré-import de la liste.
    if (statut === "oppose") {
      await ajouterOptout(p.email, "manuel", p.id);
      notifier("Opposition enregistrée dans le registre global.");
    } else if (statut === "bounce") {
      await ajouterOptout(p.email, "bounce", p.id);
      notifier("Adresse en erreur — ajoutée au registre.");
    } else {
      notifier("Statut mis à jour.");
    }
  };

  const ajouterNote = async (p: Prospect, observations: string) => {
    await journaliser(p, { type: "note", observations });
    notifier("Note ajoutée au journal.");
  };

  // La promotion passe par une confirmation : l'appariement automatique échoue
  // dès que le client est enregistré sous une autre adresse que le prospect.
  const [aPromouvoir, setAPromouvoir] = useState<Prospect | null>(null);
  const [aDetacher, setADetacher] = useState<Prospect | null>(null);
  const [statutDetache, setStatutDetache] = useState<ProspectStatut>("interesse");

  const supprimer = async () => {
    if (!aSupprimer) return;
    await deleteProspect(aSupprimer.id);
    setASupprimer(null);
    notifier("Prospect supprimé. Une éventuelle opposition reste enregistrée.");
  };

  if (!userProfile || !isAdmin) return null;

  const quotaAtteint = envoyesAujourdhui >= QUOTA_JOUR;

  return (
    <div className="min-h-screen">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium bg-green-600 text-white">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-start gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Mailing</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Prospection par corps de métier — un message ciblé, en petits volumes.
          </p>
        </div>
        {/* Les libellés longs sont tronqués sous sm : quatre boutons pleins
            débordaient de l'écran, le dernier passant hors cadre. */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div
            className={`px-3 py-2 rounded-lg text-sm ${
              quotaAtteint ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600"
            }`}
            title="Plafond quotidien : le volume est la première cause de dérive en spam."
          >
            {`${envoyesAujourdhui}/${QUOTA_JOUR}`}
            <span className="hidden sm:inline">{" aujourd'hui"}</span>
          </div>
          <button
            onClick={() => setAnnuaireOuvert(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border text-sm font-medium hover:bg-gray-50 transition"
            title="Extraire des artisans depuis l'annuaire public"
          >
            <MagnifyingGlassIcon className="w-4 h-4" /> Annuaire
          </button>
          <button
            onClick={() => setEnrichOuvert(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border text-sm font-medium hover:bg-gray-50 transition"
            title="Compléter effectif, activité et état depuis l'annuaire public des entreprises"
          >
            <BuildingOffice2Icon className="w-4 h-4" /> Enrichir
          </button>
          {nbDoublons > 0 && (
            <button
              onClick={() => setDoublonsOuvert(true)}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium hover:bg-amber-100 transition"
              title="Fiches d'une même entreprise à rapprocher (INSEE sans email + annuaire avec email)"
            >
              <Square2StackIcon className="w-4 h-4" /> Doublons
              <span className="text-amber-600">{nbDoublons}</span>
            </button>
          )}
          <button
            onClick={() => setAjoutOuvert(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border text-sm font-medium hover:bg-gray-50 transition"
          >
            <PlusIcon className="w-4 h-4" /> Ajouter
            <span className="hidden sm:inline">un prospect</span>
          </button>
          <button
            onClick={() => setImportOuvert(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
          >
            <ArrowUpTrayIcon className="w-4 h-4" /> Importer
            <span className="hidden sm:inline">une liste</span>
          </button>
        </div>
      </div>

      {/* 5 cartes sur une grille de 2 en mobile : la dernière prend les deux
          colonnes plutôt que de rester orpheline à gauche. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        {[
          { l: "Prospects", v: stats.total },
          { l: "À contacter", v: stats.aContacter },
          { l: "Contactés", v: stats.envoyes },
          { l: "Réponses", v: stats.repondus },
          { l: "Taux de réponse", v: `${stats.taux} %` },
        ].map((s) => (
          <div key={s.l} className="border rounded-xl px-3 py-2.5 bg-white">
            <div className="text-xs text-gray-500">{s.l}</div>
            <div className="text-lg font-semibold">{s.v}</div>
          </div>
        ))}
      </div>

      {/* Borne de mesure. Sans elle, les 1070 envois repris d'AppSheet — restés
          sans réponse — écrasent le taux d'une nouvelle campagne. */}
      {/* Champ de date TOUJOURS visible : derrière un menu « à partir d'une
          date », il restait invisible tant qu'on n'avait pas deviné qu'il
          fallait d'abord basculer le menu. Vide = tout l'historique. */}
      <div className="flex flex-wrap items-center gap-2 mb-5 text-xs text-gray-600">
        <span>Compter les envois et réponses à partir du</span>
        <input
          type="date"
          value={depuis}
          onChange={(e) => majDepuis(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-xs bg-white"
        />
        {depuis !== "2026-09-01" && (
          <button
            onClick={() => majDepuis("2026-09-01")}
            className="px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-gray-50 transition"
          >
            1ᵉʳ septembre 2026
          </button>
        )}
        {depuis && (
          <button
            onClick={() => majDepuis("")}
            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition"
          >
            Tout l&apos;historique
          </button>
        )}
        <span className="text-gray-400">
          {depuis
            ? `Cohorte : ${stats.envoyes} prospect(s) contacté(s) depuis cette date.`
            : "Champ vide = tout l'historique, y compris les 1070 envois repris de l'ancien système restés sans réponse. Le taux affiché n'est donc pas celui de tes campagnes actuelles."}
        </span>
      </div>

      {/* La bordure vit sur le conteneur externe : le conteneur défilant peut
          ainsi bloquer l'axe vertical (`overflow-x: auto` force sinon
          `overflow-y: auto`, d'où un scroll haut/bas parasite) sans rogner le
          soulignement de l'onglet actif. */}
      <div className="border-b mb-4">
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden -mb-px">
        {([
          { k: "prospects", l: "Prospects", icon: UsersIcon, n: compteurs?.prospects },
          { k: "kits", l: "Kits métier", icon: RectangleStackIcon, n: compteurs?.kits },
          { k: "composer", l: "Composer", icon: PaperAirplaneIcon, n: compteurs?.contactables },
          // Pas de compteur sur Suivi : un nombre d'événements n'apprend rien.
          { k: "suivi", l: "Suivi", icon: ChartBarIcon, n: undefined },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setOnglet(t.k)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              onglet === t.k
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.l}
            {typeof t.n === "number" && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  onglet === t.k ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {t.n}
              </span>
            )}
          </button>
        ))}
        </div>
      </div>

      {onglet === "prospects" && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher une société, un email, une ville…"
              className="flex-1 min-w-48 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
            />
            {/* Affiché seulement quand il y a quelque chose à réinitialiser, avec
                le nombre de filtres actifs : sur six critères combinables, on
                oublie vite lequel masque la moitié de la liste. */}
            {nbFiltresActifs > 0 && (
              <button
                onClick={reinitialiserFiltres}
                className="px-3 py-2 rounded-lg border text-sm font-medium text-gray-600 hover:bg-gray-50 transition whitespace-nowrap"
              >
                Réinitialiser les filtres
                <span className="ml-1.5 text-gray-400">{nbFiltresActifs}</span>
              </button>
            )}
            <button
              onClick={() => {
                // Quitter le mode vide la sélection : la garder en réserve
                // ferait agir plus tard sur des lignes qu'on ne voit plus.
                setModeSelection(!modeSelection);
                setSelection(new Set());
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                modeSelection
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "border text-gray-600 hover:bg-gray-50"
              }`}
            >
              {modeSelection ? "Quitter la sélection" : "Sélectionner"}
            </button>
          </div>

          {/* Filtres en pastilles : les compteurs montrent d'un coup d'œil où en
              est la liste, ce qu'un menu fermé ne peut pas faire. */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Chip
              actif={filtreStatut === "tous"}
              onClick={() => setFiltreStatut("tous")}
              label="Tous"
              nombre={prospects.length}
            />
            {/* Tous les statuts sont listés, même vides : en masquer ceux à zéro
                laissait croire à un oubli plutôt qu'à une absence de données. */}
            {(Object.keys(STATUT_LABEL) as ProspectStatut[]).map((s) => {
              const n = prospects.filter((p) => p.statut === s).length;
              return (
                <Chip
                  key={s}
                  actif={filtreStatut === s}
                  onClick={() => setFiltreStatut(s)}
                  label={STATUT_LABEL[s]}
                  nombre={n}
                  attenue={n === 0}
                />
              );
            })}
          </div>

          {/* Territoires : régions d'abord, puis départements de la région
              retenue — sinon la liste devient illisible dès 20 départements. */}
          {territoires.regions.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Chip
                actif={filtreRegion === "tous"}
                onClick={() => { setFiltreRegion("tous"); setFiltreDept("tous"); }}
                label="Toutes régions"
              />
              {territoires.regions.map(([r, n]) => (
                <Chip
                  key={r}
                  actif={filtreRegion === r}
                  onClick={() => { setFiltreRegion(r); setFiltreDept("tous"); }}
                  label={r}
                  nombre={n}
                />
              ))}
            </div>
          )}

          {territoires.depts.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Chip
                actif={filtreDept === "tous"}
                onClick={() => setFiltreDept("tous")}
                label="Tous départements"
              />
              {territoires.depts
                .filter(([, d]) => filtreRegion === "tous" || d.region === filtreRegion)
                .map(([code, d]) => (
                  <Chip
                    key={code}
                    actif={filtreDept === code}
                    onClick={() => setFiltreDept(code)}
                    label={`${code} ${d.nom}`}
                    nombre={d.n}
                  />
                ))}
            </div>
          )}

          {metiers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Chip
                actif={filtreMetier === "tous"}
                onClick={() => setFiltreMetier("tous")}
                label="Tous les métiers"
              />
              {metiers.map((m) => (
                <Chip
                  key={m.id}
                  actif={filtreMetier === m.id}
                  onClick={() => setFiltreMetier(m.id)}
                  label={m.metier}
                  nombre={prospects.filter((p) => p.metierId === m.id).length}
                />
              ))}
            </div>
          )}

          {/* Taille d'entreprise : toujours affichée, y compris les paliers vides
              (en pointillés) — un filtre qui masque ses catégories vides donne
              l'impression d'un oubli. */}
          <FiltreRayon {...rayon} />

          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const cessees = prospects.filter((p) => estCessee(p.etatEntreprise)).length;
              return (
                <>
                  <Chip actif={filtreEtat === "tous"} onClick={() => setFiltreEtat("tous")} label="Tous états" />
                  <Chip
                    actif={filtreEtat === "actives"}
                    onClick={() => setFiltreEtat("actives")}
                    label="En activité"
                    nombre={prospects.length - cessees}
                  />
                  <Chip
                    actif={filtreEtat === "cessees"}
                    onClick={() => setFiltreEtat("cessees")}
                    label="Sociétés cessées"
                    nombre={cessees}
                    attenue={cessees === 0}
                  />
                </>
              );
            })()}
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip
              actif={filtreEffectif === "tous"}
              onClick={() => setFiltreEffectif("tous")}
              label="Toutes tailles"
            />
            {GROUPES_EFFECTIF.map((g) => {
              const n = prospects.filter((p) => groupeEffectif(p.effectifCode) === g.id).length;
              return (
                <Chip
                  key={g.id}
                  actif={filtreEffectif === g.id}
                  onClick={() => setFiltreEffectif(g.id)}
                  label={g.label}
                  nombre={n}
                  attenue={n === 0}
                />
              );
            })}
          </div>

          {/* Priorité : DEUX listes distinctes — mes prioritaires (manuel, à
              contacter en premier) et les suggestions automatiques. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const nManuel = prospects.filter((p) => estPrioritaireManuel(p)).length;
              const nAuto = prospects.filter((p) => estPrioritaireAuto(p, rayon.distance(p))).length;
              return (
                <>
                  <Chip actif={filtrePriorite === "tous"} onClick={() => setFiltrePriorite("tous")} label="Toutes priorités" />
                  <Chip
                    actif={filtrePriorite === "manuel"}
                    onClick={() => setFiltrePriorite("manuel")}
                    label="★ Mes prioritaires"
                    nombre={nManuel}
                    attenue={nManuel === 0}
                  />
                  <Chip
                    actif={filtrePriorite === "auto"}
                    onClick={() => setFiltrePriorite("auto")}
                    label="Suggérées (auto)"
                    nombre={nAuto}
                    attenue={nAuto === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Email rattaché ou non — les prospects INSEE arrivent souvent sans
              adresse (statut « Email à trouver »), on veut pouvoir les isoler. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const avec = prospects.filter((p) => !!p.email?.trim()).length;
              const sans = prospects.length - avec;
              return (
                <>
                  <Chip actif={filtreEmail === "tous"} onClick={() => setFiltreEmail("tous")} label="Email : tous" />
                  <Chip
                    actif={filtreEmail === "avec"}
                    onClick={() => setFiltreEmail("avec")}
                    label="Avec email"
                    nombre={avec}
                    attenue={avec === 0}
                  />
                  <Chip
                    actif={filtreEmail === "sans"}
                    onClick={() => setFiltreEmail("sans")}
                    label="Sans email"
                    nombre={sans}
                    attenue={sans === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Logiciel de gestion : en a un / n'en a pas / on ne sait pas. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const oui = prospects.filter((p) => etatLogiciel(p) === "oui").length;
              const non = prospects.filter((p) => etatLogiciel(p) === "non").length;
              const inconnu = prospects.length - oui - non;
              return (
                <>
                  <Chip actif={filtreLogiciel === "tous"} onClick={() => setFiltreLogiciel("tous")} label="Logiciel : tous" />
                  <Chip
                    actif={filtreLogiciel === "oui"}
                    onClick={() => setFiltreLogiciel("oui")}
                    label="A un logiciel"
                    nombre={oui}
                    attenue={oui === 0}
                  />
                  <Chip
                    actif={filtreLogiciel === "non"}
                    onClick={() => setFiltreLogiciel("non")}
                    label="Sans logiciel"
                    nombre={non}
                    attenue={non === 0}
                  />
                  <Chip
                    actif={filtreLogiciel === "inconnu"}
                    onClick={() => setFiltreLogiciel("inconnu")}
                    label="Logiciel inconnu"
                    nombre={inconnu}
                    attenue={inconnu === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Signaux de l'étude : admin dédié, développement, site, angle. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const adminOui = prospects.filter((p) => p.responsableAdmin === true).length;
              const dev = prospects.filter((p) => p.enDeveloppement === true).length;
              const siteBancal = prospects.filter((p) => p.siteEtat === "bancal").length;
              const siteAucun = prospects.filter((p) => p.siteEtat === "aucun").length;
              return (
                <>
                  <Chip
                    actif={filtreAdmin === "oui"}
                    onClick={() => setFiltreAdmin(filtreAdmin === "oui" ? "tous" : "oui")}
                    label="💼 Resp Admin dédié"
                    nombre={adminOui}
                    attenue={adminOui === 0}
                  />
                  <Chip
                    actif={filtreDev === "oui"}
                    onClick={() => setFiltreDev(filtreDev === "oui" ? "tous" : "oui")}
                    label="📈 En développement"
                    nombre={dev}
                    attenue={dev === 0}
                  />
                  <Chip
                    actif={filtreSite === "bancal"}
                    onClick={() => setFiltreSite(filtreSite === "bancal" ? "tous" : "bancal")}
                    label="🌐 Site à refaire"
                    nombre={siteBancal}
                    attenue={siteBancal === 0}
                  />
                  <Chip
                    actif={filtreSite === "aucun"}
                    onClick={() => setFiltreSite(filtreSite === "aucun" ? "tous" : "aucun")}
                    label="🌐 Sans site"
                    nombre={siteAucun}
                    attenue={siteAucun === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Angle recommandé par l'étude. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              // Un prospect peut porter PLUSIEURS angles : les compteurs se recoupent,
              // c'est voulu (chaque angle est une cartouche indépendante).
              return (
                <>
                  <Chip actif={filtreAngle === "tous"} onClick={() => setFiltreAngle("tous")} label="Angle : tous" />
                  {ANGLES.map((a) => {
                    const n = prospects.filter((p) => anglesDe(p).includes(a.id)).length;
                    return (
                      <Chip
                        key={a.id}
                        actif={filtreAngle === a.id}
                        onClick={() => setFiltreAngle(a.id)}
                        label={`🎯 ${a.label}`}
                        nombre={n}
                        attenue={n === 0}
                      />
                    );
                  })}
                  <Chip
                    actif={filtreLie}
                    onClick={() => setFiltreLie((v) => !v)}
                    label="👥 Liés (groupe)"
                    nombre={liensGroupe.size}
                    attenue={liensGroupe.size === 0}
                  />
                  {(() => {
                    const n = prospects.filter((p) => !!p.mailPerso).length;
                    return (
                      <Chip
                        actif={filtreMailPerso}
                        onClick={() => setFiltreMailPerso((v) => !v)}
                        label="✍ Mail adapté"
                        nombre={n}
                        attenue={n === 0}
                      />
                    );
                  })()}
                </>
              );
            })()}
          </div>

          {/* État de la recherche : rien fait / prompt lancé / infos récupérées. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const etudie = prospects.filter((p) => etatEtude(p) === "etudie").length;
              const lance = prospects.filter((p) => etatEtude(p) === "lance").length;
              const rien = prospects.filter((p) => etatEtude(p) === "rien").length;
              return (
                <>
                  <Chip actif={filtreEtude === "tous"} onClick={() => setFiltreEtude("tous")} label="Recherche : toutes" />
                  <Chip
                    actif={filtreEtude === "etudie"}
                    onClick={() => setFiltreEtude("etudie")}
                    label="✨ Infos récupérées"
                    nombre={etudie}
                    attenue={etudie === 0}
                  />
                  <Chip
                    actif={filtreEtude === "lance"}
                    onClick={() => setFiltreEtude("lance")}
                    label="Prompt lancé"
                    nombre={lance}
                    attenue={lance === 0}
                  />
                  <Chip
                    actif={filtreEtude === "rien"}
                    onClick={() => setFiltreEtude("rien")}
                    label="Rien fait"
                    nombre={rien}
                    attenue={rien === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Profil générationnel du dirigeant (appétence logiciel). */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(() => {
              const jeune = prospects.filter((p) => p.dirigeantJeune === true).length;
              const senior = prospects.filter((p) => p.dirigeantJeune === false).length;
              return (
                <>
                  <Chip actif={filtreGerant === "tous"} onClick={() => setFiltreGerant("tous")} label="Gérant : tous" />
                  <Chip
                    actif={filtreGerant === "jeune"}
                    onClick={() => setFiltreGerant(filtreGerant === "jeune" ? "tous" : "jeune")}
                    label="🎂 Gérant jeune"
                    nombre={jeune}
                    attenue={jeune === 0}
                  />
                  <Chip
                    actif={filtreGerant === "senior"}
                    onClick={() => setFiltreGerant(filtreGerant === "senior" ? "tous" : "senior")}
                    label="🎂 Gérant senior"
                    nombre={senior}
                    attenue={senior === 0}
                  />
                </>
              );
            })()}
          </div>

          {/* Barre d'actions groupées : n'apparaît qu'une fois une sélection
              faite, pour ne pas encombrer la vue de lecture. */}
          {selectionnes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100">
              <span className="text-sm font-medium text-blue-900">
                {selectionnes.length} sélectionné{selectionnes.length > 1 ? "s" : ""}
              </span>
              <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                <select
                  value={statutLot}
                  onChange={(e) => setStatutLot(e.target.value as ProspectStatut)}
                  className="border rounded-lg px-2 py-1.5 text-xs bg-white"
                >
                  {(Object.keys(STATUT_LABEL) as ProspectStatut[]).map((s) => (
                    <option key={s} value={s}>{STATUT_LABEL[s]}</option>
                  ))}
                </select>
                <button
                  onClick={() => setActionLot("statut")}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  Appliquer l&apos;état
                </button>
                <select
                  value={metierLot}
                  onChange={(e) => setMetierLot(e.target.value)}
                  className="border rounded-lg px-2 py-1.5 text-xs bg-white"
                >
                  <option value="">— Métier —</option>
                  {metiers.map((m) => (
                    <option key={m.id} value={m.id}>{m.metier}</option>
                  ))}
                </select>
                <button
                  onClick={() => setActionLot("metier")}
                  disabled={!metierLot}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Changer le métier
                </button>
                <input
                  value={groupeLot}
                  onChange={(e) => setGroupeLot(e.target.value)}
                  placeholder="Nom du groupe"
                  className="border rounded-lg px-2 py-1.5 text-xs bg-white w-32"
                />
                <button
                  onClick={() => setActionLot("groupe")}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-white text-gray-700 hover:bg-gray-50 transition"
                  title="Marquer les sélectionnés comme appartenant au même groupe"
                >
                  Même groupe
                </button>
                <button
                  onClick={() => setActionLot("insee")}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-white text-gray-700 hover:bg-gray-50 transition"
                >
                  Effacer données INSEE
                </button>
                <button
                  onClick={() => setActionLot("supprimer")}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-white text-red-600 hover:bg-red-50 transition"
                >
                  Supprimer
                </button>
                <button
                  onClick={() => setSelection(new Set())}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-white transition"
                >
                  Désélectionner
                </button>
              </div>
            </div>
          )}

          {/* Même formulation que le composeur (« X affichés sur Y ») : le
              total rappelle ce que les filtres écartent. */}
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-3">
            {modeSelection && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={listeFiltree.length > 0 && selectionnes.length === listeFiltree.length}
                  onChange={(e) =>
                    setSelection(e.target.checked ? new Set(listeFiltree.map((p) => p.id)) : new Set())
                  }
                />
                {/* « Tout » = tout ce qui est AFFICHÉ, donc filtré — c'est ce qui
                    rend le couple filtres + sélection réellement utile. */}
                <span>Tout sélectionner ({listeFiltree.length})</span>
              </label>
            )}
            <span>
            {nbFiltresActifs === 0 ? (
              <>
                <span className="font-medium text-gray-700">{prospects.length}</span> prospect
                {prospects.length > 1 ? "s" : ""}
              </>
            ) : (
              <>
                <span className="font-medium text-gray-700">{listeFiltree.length}</span> affiché
                {listeFiltree.length > 1 ? "s" : ""} sur {prospects.length}
                {rayon.rayon !== null && (
                  <span className="text-gray-400">
                    {" "}· triés du plus proche de {rayon.cpRef}
                  </span>
                )}
              </>
            )}
            </span>
          </div>

          {listeFiltree.length === 0 ? (
            <div className="border rounded-xl px-4 py-10 text-center text-sm text-gray-500 bg-white">
              {nbFiltresActifs > 0
                ? "Aucun prospect ne correspond à ces filtres."
                : "Aucun prospect. Commence par importer une liste CSV."}
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-white divide-y">
              {listeFiltree.map((p) => {
                const blocage = peutContacter(p, optouts);
                // Mobile : infos sur toute la largeur, actions en dessous. En une
                // seule rangée (l'ancien comportement), le select et les cinq
                // boutons mangeaient la place et le nom tombait à « 2… ».
                return (
                  <div
                    key={p.id}
                    className="px-3 py-2.5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-3 sm:gap-y-1.5"
                  >
                    {/* Case + infos dans un même bloc horizontal : en colonne
                        (mobile), la case seule occuperait toute une ligne. */}
                    <div className="flex items-start gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
                    {modeSelection && (
                      <input
                        type="checkbox"
                        checked={selection.has(p.id)}
                        onChange={() => basculerSelection(p.id)}
                        className="mt-1 shrink-0"
                        aria-label={`Sélectionner ${p.societe}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const mien = estPrioritaireManuel(p);
                          const ev = evaluerPrioriteAuto(p, rayon.distance(p));
                          const auto = ev.auto;
                          return (
                            <>
                              {/* Étoile DORÉE = mes prioritaires (à contacter en premier). */}
                              <button
                                onClick={() => basculerPriorite(p)}
                                className={`shrink-0 p-0.5 rounded transition ${
                                  mien
                                    ? "text-amber-500 hover:bg-amber-50"
                                    : "text-gray-300 hover:text-amber-500 hover:bg-amber-50"
                                }`}
                                title={
                                  mien
                                    ? "Dans mes prioritaires (à contacter en premier). Cliquer pour retirer."
                                    : "Marquer comme prioritaire (à contacter en premier)."
                                }
                                aria-label={mien ? "Retirer de mes prioritaires" : "Ajouter à mes prioritaires"}
                              >
                                {mien ? <StarSolid className="w-4 h-4" /> : <StarIcon className="w-4 h-4" />}
                              </button>
                              {/* Pastille BLEUE = simple suggestion automatique, distincte. */}
                              {auto && (
                                <span
                                  className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-100 text-sky-700"
                                  title={`Suggéré par le score auto (${ev.score}/${ev.max})${ev.raisons.length ? ` — ${ev.raisons.join(", ")}` : ""}`}
                                >
                                  <SparklesIcon className="w-3 h-3" />
                                  auto
                                </span>
                              )}
                            </>
                          );
                        })()}
                        <span className="font-medium text-sm truncate">{p.societe}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUT_STYLE[p.statut]}`}>
                          {STATUT_LABEL[p.statut]}
                        </span>
                        {p.effectifCode && (
                          <span
                            className={`${BADGE.base} ${BADGE.effectifInsee}`}
                            title={`Tranche INSEE${p.effectifAnnee ? ` (${p.effectifAnnee})` : ""}${
                              p.effectifDeLEntreprise ? " — au niveau de l'entreprise" : ""
                            }`}
                          >
                            {libelleEffectif(p.effectifCode)}
                          </span>
                        )}
                        {(() => {
                          const aLog = p.aLogiciel === true || (p.aLogiciel === undefined && !!p.logicielActuel);
                          const sansLog = p.aLogiciel === false;
                          if (aLog) return (
                            <span
                              className={`${BADGE.base} ${BADGE.logiciel}`}
                              title={p.logicielActuel ? `Logiciel en place : ${p.logicielActuel}` : "A déjà un logiciel de gestion"}
                            >
                              🧩 {p.logicielActuel || "Logiciel"}
                            </span>
                          );
                          if (sansLog) return (
                            <span
                              className={`${BADGE.base} ${BADGE.sansLogiciel}`}
                              title="Aucun logiciel de gestion — pas de concurrent en place"
                            >
                              sans logiciel
                            </span>
                          );
                          return null;
                        })()}
                        {p.responsableAdmin === true && (
                          <span
                            className={`${BADGE.base} ${BADGE.adminDedie}`}
                            title="Une personne dédiée à l'administratif/gestion — signal fort"
                          >
                            💼 Resp Admin dédié
                          </span>
                        )}
                        {p.enDeveloppement === true && (
                          <span
                            className={`${BADGE.base} ${BADGE.enDev}`}
                            title="En développement — recrutement, CA en hausse, rachat récent…"
                          >
                            📈 en dév.
                          </span>
                        )}
                        {p.siteEtat === "bancal" && (
                          <span
                            className={`${BADGE.base} ${BADGE.siteARefaire}`}
                            title="Site bancal / à moitié fait / à l'abandon — opportunité de refonte"
                          >
                            🌐 site à refaire
                          </span>
                        )}
                        {p.siteEtat === "aucun" && (
                          <span
                            className={`${BADGE.base} ${BADGE.sansSite}`}
                            title="Pas de site web — opportunité"
                          >
                            🌐 sans site
                          </span>
                        )}
                        {p.effectifReel && (
                          <span
                            className={`${BADGE.base} ${BADGE.effectifReel}`}
                            title="Effectif réel trouvé par l'étude"
                          >
                            👷 {p.effectifReel}
                          </span>
                        )}
                        {p.mailPerso && (
                          <span
                            className={`${BADGE.base} ${BADGE.mailAdapte}`}
                            title="Le mail a été réécrit pour cette société : le kit métier ne sert plus pour elle"
                          >
                            ✍ mail adapté
                          </span>
                        )}
                        {anglesDe(p).map((a) => (
                          <span
                            key={a}
                            className={`${BADGE.base} ${BADGE.angle}`}
                            title="Angle d'accroche retenu par l'étude"
                          >
                            🎯 {angleLabel(a)}
                          </span>
                        ))}
                        {estCessee(p.etatEntreprise) && (
                          <span className={`${BADGE.base} ${BADGE.cessee}`}>société cessée</span>
                        )}
                        {(() => {
                          const etudie = !!(p.etudeAt || p.dirigeant || p.personnalisation || p.etudeResume);
                          if (etudie) return (
                            <span
                              className={`${BADGE.base} ${BADGE.etudie}`}
                              title={`Entreprise étudiée${p.etudeAt ? ` le ${p.etudeAt.toDate().toLocaleDateString("fr-FR")}` : ""} — infos récupérées`}
                            >
                              ✨ étudié
                            </span>
                          );
                          if (p.promptLanceAt) return (
                            <span
                              className={`${BADGE.base} ${BADGE.promptLance}`}
                              title={`Prompt lancé le ${p.promptLanceAt.toDate().toLocaleDateString("fr-FR")} — résultat pas encore collé`}
                            >
                              prompt lancé
                            </span>
                          );
                          return null;
                        })()}
                        {p.dirigeant && (
                          <span
                            className={`${BADGE.base} ${BADGE.dirigeant}`}
                            title={`Dirigeant — à qui écrire${p.dirigeantAge ? ` (${p.dirigeantAge})` : ""}`}
                          >
                            👤 {p.dirigeant}
                          </span>
                        )}
                        {p.dirigeantJeune === true && (
                          <span
                            className={`${BADGE.base} ${BADGE.gerantJeune}`}
                            title={`Dirigeant jeune${p.dirigeantAge ? ` (${p.dirigeantAge})` : ""} — a priori plus réceptif au numérique`}
                          >
                            🎂 Gérant jeune
                          </span>
                        )}
                        {p.dirigeantJeune === false && (
                          <span
                            className={`${BADGE.base} ${BADGE.gerantSenior}`}
                            title={`Dirigeant senior${p.dirigeantAge ? ` (${p.dirigeantAge})` : ""} — souvent fin de carrière, moins outillé`}
                          >
                            🎂 Gérant senior
                          </span>
                        )}
                        {(() => {
                          const lies = liensGroupe.get(p.id);
                          if (!lies || lies.size === 0) return null;
                          const liste = [...lies.values()].map((o) => o.societe);
                          return (
                            <span
                              className={`${BADGE.base} ${BADGE.groupe} max-w-[16rem] truncate`}
                              title={`Même groupe/dirigeant que : ${liste.join(", ")} — inutile de contacter les deux`}
                            >
                              👥 lié à {liste[0]}{liste.length > 1 ? ` +${liste.length - 1}` : ""}
                            </span>
                          );
                        })()}
                        {isEmailGenerique(p.email) && (
                          <span
                            className={`${BADGE.base} ${BADGE.generique}`}
                            title="Adresse générique : joignable, mais moins bien ciblée qu'une adresse nominative."
                          >
                            générique
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {p.email}
                        {p.metier ? ` · ${p.metier}` : ""}
                        {p.ville ? ` · ${p.ville}` : ""}
                        {(p.nbEnvois ?? 0) > 0 ? ` · ${p.nbEnvois} envoi${(p.nbEnvois ?? 0) > 1 ? "s" : ""}` : ""}
                      </div>
                      {!blocage.ok && (
                        <div className="text-[11px] text-amber-700 mt-0.5">{blocage.raison}</div>
                      )}
                    </div>
                    </div>

                    {/* Rangée d'actions : pleine largeur sous les infos en mobile,
                        alignée à droite dès sm. */}
                    <div className="flex items-center gap-1 flex-wrap w-full sm:w-auto sm:contents">
                    <select
                      value={p.statut}
                      onChange={(e) =>
                        setStatutEnCours({ prospect: p, cible: e.target.value as ProspectStatut })
                      }
                      className="border rounded-lg px-2 py-1.5 text-xs max-w-[10rem] sm:max-w-none"
                    >
                      {(Object.keys(STATUT_LABEL) as ProspectStatut[]).map((s) => (
                        <option key={s} value={s}>{STATUT_LABEL[s]}</option>
                      ))}
                    </select>

                    {p.clientId && (
                      <button
                        onClick={() => setADetacher(p)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border text-gray-600 hover:bg-gray-50 transition"
                        title="Annuler le rattachement à la fiche client"
                      >
                        Détacher
                      </button>
                    )}

                    {(p.statut === "repondu" || p.statut === "interesse") && !p.clientId && (
                      <button
                        onClick={() => setAPromouvoir(p)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition"
                      >
                        Promouvoir en client
                      </button>
                    )}

                    {p.enrichiAt && (
                      <button
                        onClick={() => setADesenrichir(p)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition"
                        title="Effacer les données INSEE (mauvais appariement)"
                      >
                        <BuildingOffice2Icon className="w-4 h-4" />
                      </button>
                    )}
                    {(p.nbEnvois ?? 0) > 0 && (
                      <button
                        onClick={() => setADesenvoyer(p)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition"
                        title="Annuler le dernier envoi (mail jamais parti)"
                      >
                        <ArrowUturnLeftIcon className="w-4 h-4" />
                      </button>
                    )}
                    {(() => {
                      const etudie = !!(p.etudeAt || p.dirigeant || p.personnalisation || p.etudeResume);
                      const lance = !!p.promptLanceAt;
                      const cls = etudie
                        ? "text-violet-600 bg-violet-50 hover:bg-violet-100"
                        : lance
                          ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                          : "text-gray-400 hover:text-violet-600 hover:bg-violet-50";
                      const titre = etudie
                        ? "Entreprise déjà étudiée — voir / mettre à jour"
                        : lance
                          ? "Prompt déjà lancé (résultat pas encore collé)"
                          : "Étudier cette entreprise (prompt de recherche IA)";
                      return (
                        <button
                          onClick={() => setAEtudier(p)}
                          className={`p-1.5 rounded-lg transition ${cls}`}
                          title={titre}
                        >
                          <SparklesIcon className="w-4 h-4" />
                        </button>
                      );
                    })()}
                    {/* Adapter le mail : le geste naturel juste après l'étude.
                        Il existait déjà dans la file d'envoi, mais on n'y arrive
                        qu'une fois les envois lancés — trop tard pour rédiger. */}
                    {(() => {
                      const kit = metiers.find((m) => m.id === p.metierId);
                      const dispo = !!kit && estMailCourt(kit);
                      return (
                        <button
                          onClick={() => dispo && setAAdapter({ prospect: p, metier: kit! })}
                          disabled={!dispo}
                          className={`p-1.5 rounded-lg transition ${
                            p.mailPerso
                              ? "text-violet-600 bg-violet-50 hover:bg-violet-100"
                              : dispo
                                ? "text-gray-400 hover:text-violet-600 hover:bg-violet-50"
                                : "text-gray-200 cursor-not-allowed"
                          }`}
                          title={
                            !kit
                              ? "Aucun kit métier associé à ce prospect"
                              : !dispo
                                ? `Le kit « ${kit.metier} » n'est pas au format mail court`
                                : p.mailPerso
                                  ? "Mail adapté à cette société — modifier"
                                  : "Adapter le mail à cette société"
                          }
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => setStatutEnCours({ prospect: p })}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                      title="Ajouter une note"
                    >
                      <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHistorique(historique === p.id ? null : p.id)}
                      className={`p-1.5 rounded-lg transition ${
                        historique === p.id
                          ? "text-blue-600 bg-blue-50"
                          : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      }`}
                      title="Historique"
                    >
                      <ClockIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setAEditer(p)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                      title="Modifier"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setASupprimer(p)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      title="Supprimer"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                    </div>

                    {historique === p.id && (
                      <div className="w-full mt-1.5 pl-3 border-l-2 border-blue-100 space-y-1.5">
                        {/* Repères toujours disponibles, même pour les prospects
                            antérieurs au journal : eux n'ont aucun événement. */}
                        <div className="text-[11px] text-gray-500 pb-0.5">
                          Créé le {fmtDateHeure(p.createdAt)}
                          {p.dernierEnvoiAt ? (
                            <>
                              {" · "}
                              {(p.nbEnvois ?? 0) > 1 ? "dernier envoi le " : "envoyé le "}
                              <span className="text-gray-700">{fmtDateHeure(p.dernierEnvoiAt)}</span>
                              {(p.nbEnvois ?? 0) > 1 ? ` (${p.nbEnvois} envois)` : ""}
                            </>
                          ) : (
                            <span className="text-gray-400"> · jamais contacté</span>
                          )}
                        </div>

                        {/* Sociétés liées (même dirigeant / même groupe). */}
                        {(() => {
                          const lies = liensGroupe.get(p.id);
                          if (!lies || lies.size === 0) return null;
                          const noms = [...lies.values()].map((o) => o.societe);
                          return (
                            <div className="text-[11px] rounded-lg bg-orange-50 border border-orange-100 px-2.5 py-1.5">
                              <span className="text-orange-700 font-medium">👥 Lié à</span>{" "}
                              <span className="text-gray-700">{noms.join(", ")}</span>
                              <span className="text-gray-400"> — inutile de contacter les deux.</span>
                            </div>
                          );
                        })()}

                        {/* Étude IA enregistrée sur la fiche. */}
                        {(p.dirigeant || p.personnalisation || p.angle || p.etudeResume) && (
                          <div className="text-[11px] rounded-lg bg-violet-50 border border-violet-100 px-2.5 py-1.5 space-y-0.5">
                            <span className="text-violet-700 font-medium">Étude</span>
                            {p.etudeAt && <span className="text-gray-400"> · {fmtDateHeure(p.etudeAt)}</span>}
                            {p.dirigeant && (
                              <div className="text-gray-700">👤 {p.dirigeant}</div>
                            )}
                            {(p.dirigeantAge || p.dirigeantJeune !== undefined) && (
                              <div className="text-gray-600">
                                🎂 {[
                                  p.dirigeantAge,
                                  p.dirigeantJeune === true ? "gérant jeune" : p.dirigeantJeune === false ? "gérant senior" : null,
                                ].filter(Boolean).join(" · ")}
                              </div>
                            )}
                            {p.personnalisation && (
                              <div className="text-gray-700">✍ {p.personnalisation}</div>
                            )}
                            {anglesDe(p).length > 0 && (
                              <div className="text-gray-600">
                                🎯 Angles : {anglesDe(p).map(angleLabel).join(" · ")}
                              </div>
                            )}
                            {p.etudeResume && (
                              <div className="text-gray-600 whitespace-pre-wrap">{p.etudeResume}</div>
                            )}
                          </div>
                        )}
                        {/* Note saisie sur la fiche avant que les notes ne passent
                            au journal : affichée ici pour ne pas la perdre. */}
                        {p.notes?.trim() && (
                          <div className="text-[11px]">
                            <span className="text-gray-400">Note de la fiche</span>
                            <div className="text-gray-600 whitespace-pre-wrap">{p.notes}</div>
                          </div>
                        )}
                        {evenements.filter((e) => e.prospectId === p.id).length === 0 && !p.notes?.trim() ? (
                          <div className="text-[11px] text-gray-400">
                            Aucun événement — le journal a démarré après la création de ce prospect.
                          </div>
                        ) : (
                          evenements
                            .filter((e) => e.prospectId === p.id)
                            .map((e) => (
                              <div key={e.id} className="flex items-start gap-2">
                                <span
                                  className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${EVT_STYLE[e.type]}`}
                                >
                                  {EVT_LABEL[e.type]}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline gap-1.5 flex-wrap text-[11px]">
                                    {e.type === "statut" && e.statutAvant && e.statutApres && (
                                      <span className="flex items-center gap-1">
                                        <span className={`px-1.5 py-0.5 rounded-full ${STATUT_STYLE[e.statutAvant]}`}>
                                          {STATUT_LABEL[e.statutAvant]}
                                        </span>
                                        <span className="text-gray-300">→</span>
                                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${STATUT_STYLE[e.statutApres]}`}>
                                          {STATUT_LABEL[e.statutApres]}
                                        </span>
                                      </span>
                                    )}
                                    <span className="text-gray-400">
                                      {e.createdAt?.toDate().toLocaleDateString("fr-FR", {
                                        day: "2-digit", month: "2-digit", year: "2-digit",
                                      })}
                                    </span>
                                    {typeof e.delaiDepuisEnvoi === "number" && e.type !== "envoi" && (
                                      <span className="text-gray-400">
                                        {`· J+${e.delaiDepuisEnvoi} après l'envoi`}
                                      </span>
                                    )}
                                    {/* Seules les notes sont modifiables : les faits
                                        sont verrouillés côté règles Firestore. */}
                                    {e.type === "note" && (
                                      <span className="ml-auto flex gap-2">
                                        <button
                                          onClick={() => setNoteEnEdition({ id: e.id, texte: e.observations ?? "" })}
                                          className="text-blue-600 hover:underline"
                                        >
                                          modifier
                                        </button>
                                        <button
                                          onClick={() => setNoteASupprimer(e.id)}
                                          className="text-red-600 hover:underline"
                                        >
                                          supprimer
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                  {e.observations && (
                                    <div className="text-[11px] text-gray-700 whitespace-pre-wrap mt-0.5 bg-gray-50 rounded px-2 py-1">
                                      {e.observations}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {optoutDocs.length > 0 && (
            <div className="mt-5 border rounded-xl px-4 py-3 bg-white">
              <div className="text-sm font-medium mb-1">
                Registre d&apos;opposition — {optoutDocs.length} adresse{optoutDocs.length > 1 ? "s" : ""}
              </div>
              <p className="text-xs text-gray-500">
                Global et permanent : ces adresses sont écartées automatiquement à chaque import,
                même si elles reviennent dans un nouveau fichier.
              </p>
            </div>
          )}
        </>
      )}

      {onglet === "kits" && (
        <KitEditor userId={currentUser?.uid ?? ""} metiers={metiers} onToast={notifier} />
      )}

      {onglet === "composer" && (
        <Composeur
          userId={currentUser?.uid ?? ""}
          prospects={prospects}
          metiers={metiers}
          optouts={optouts}
          envoyesAujourdhui={envoyesAujourdhui}
          onToast={notifier}
        />
      )}

      <Modal
        isOpen={!!actionLot}
        onClose={() => !lotEnCours && setActionLot(null)}
        title={
          actionLot === "statut"
            ? "Changer l'état de la sélection"
            : actionLot === "insee"
              ? "Effacer les données INSEE"
              : actionLot === "metier"
                ? "Changer le métier de la sélection"
                : actionLot === "groupe"
                  ? "Marquer comme même groupe"
                  : "Supprimer la sélection"
        }
        size="sm"
      >
        <p className="text-sm text-gray-600">
          {actionLot === "statut" && (
            <>
              <strong>{selectionnes.length}</strong> prospect(s) passeront à
              {" « "}<strong>{STATUT_LABEL[statutLot]}</strong>{" »"}.
            </>
          )}
          {actionLot === "insee" && (
            <>
              <strong>{selectionnes.length}</strong> prospect(s) perdront SIRET, effectif,
              activité, état — ainsi que le code postal et la ville, qui viennent de
              l&apos;enrichissement.
            </>
          )}
          {actionLot === "metier" && (
            <>
              <strong>{selectionnes.length}</strong> prospect(s) passeront au métier
              {" « "}<strong>{metiers.find((m) => m.id === metierLot)?.metier ?? "—"}</strong>{" »"}.
            </>
          )}
          {actionLot === "groupe" && (
            <>
              <strong>{selectionnes.length}</strong> prospect(s) seront marqués comme appartenant au
              même groupe {" « "}
              <strong>{groupeLot.trim() || `Groupe ${selectionnes[0]?.societe ?? ""}`}</strong>
              {" » "} — le badge 👥 lié apparaîtra sur chacun.
            </>
          )}
          {actionLot === "supprimer" && (
            <>
              <strong>{selectionnes.length}</strong> prospect(s) seront définitivement retirés de
              la liste. Les oppositions enregistrées, elles, sont conservées.
            </>
          )}
        </p>

        {actionLot === "statut" && (statutLot === "oppose" || statutLot === "bounce") && (
          <p className="text-xs text-amber-700 mt-2">
            Ces adresses rejoindront le registre d&apos;opposition : elles ne pourront plus jamais
            être recontactées, ni réimportées. Sur un lot, c&apos;est irréversible.
          </p>
        )}

        {lotEnCours ? (
          <div className="mt-4">
            <div className="text-xs text-gray-600 mb-1.5">
              Traitement… {lotEnCours.fait}/{lotEnCours.total}
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${lotEnCours.total ? (lotEnCours.fait / lotEnCours.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setActionLot(null)}
              className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              onClick={executerLot}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition ${
                actionLot === "supprimer"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              Confirmer
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!aDesenrichir}
        onClose={() => setADesenrichir(null)}
        title="Effacer les données INSEE ?"
        size="sm"
      >
        <p className="text-sm text-gray-600">
          <strong>{aDesenrichir?.societe}</strong>
          {" perdra son SIRET, son effectif, son activité et son état administratif."}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Le code postal et la ville sont effacés eux aussi : quand l&apos;appariement est faux,
          ils viennent de l&apos;entreprise homonyme et t&apos;indiqueraient une mauvaise
          localisation. Le prospect ressortira au prochain enrichissement — complète son code
          postal avant, c&apos;est lui qui garantit le bon rattachement.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => setADesenrichir(null)}
            className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition"
          >
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!aDesenrichir) return;
              await annulerEnrichissement(aDesenrichir);
              setADesenrichir(null);
              notifier("Données INSEE effacées.");
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 transition"
          >
            Effacer
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!aDesenvoyer}
        onClose={() => setADesenvoyer(null)}
        title="Annuler le dernier envoi ?"
        size="sm"
      >
        <p className="text-sm text-gray-600">
          <strong>{aDesenvoyer?.societe}</strong>
          {" repassera au compteur précédent : le délai avant relance se rouvre aussitôt."}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          À utiliser quand le mail n&apos;est jamais parti (clic de trop sur « Envoyé »).
          Le message archivé et le journal sont conservés — l&apos;annulation s&apos;y ajoute
          comme un fait de plus, elle n&apos;efface rien.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => setADesenvoyer(null)}
            className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition"
          >
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!aDesenvoyer) return;
              await annulerDernierEnvoi(aDesenvoyer);
              setADesenvoyer(null);
              notifier("Envoi annulé — le prospect est de nouveau contactable.");
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 transition"
          >
            Annuler l&apos;envoi
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!aSupprimer}
        onClose={() => setASupprimer(null)}
        title="Supprimer ce prospect ?"
        size="sm"
      >
        <p className="text-sm text-gray-600">
          <strong>{aSupprimer?.societe}</strong> sera retiré de la liste de prospection.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Si ce contact s&apos;était opposé, son opposition reste enregistrée dans le registre :
          il ne réapparaîtra pas lors d&apos;un prochain import.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => setASupprimer(null)}
            className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition"
          >
            Annuler
          </button>
          <button
            onClick={supprimer}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition"
          >
            Supprimer
          </button>
        </div>
      </Modal>

      {onglet === "suivi" && (
        <SuiviTab
          prospects={prospects}
          metiers={metiers}
          evenements={evenements}
          optouts={optouts}
          depuis={dateDepuis}
        />
      )}

      <Modal
        isOpen={!!noteEnEdition}
        onClose={() => setNoteEnEdition(null)}
        title="Modifier la note"
        size="sm"
      >
        <AutoTextarea
          value={noteEnEdition?.texte ?? ""}
          onChange={(v) => setNoteEnEdition((n) => (n ? { ...n, texte: v } : n))}
          minRows={3}
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
        />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setNoteEnEdition(null)} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!noteEnEdition?.texte.trim()) return;
              await modifierNote(noteEnEdition.id, noteEnEdition.texte.trim());
              setNoteEnEdition(null);
              notifier("Note modifiée.");
            }}
            disabled={!noteEnEdition?.texte.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!noteASupprimer}
        onClose={() => setNoteASupprimer(null)}
        title="Supprimer cette note ?"
        size="sm"
      >
        <p className="text-sm text-gray-600">
          Seule la note disparaît. Les envois et changements de statut du journal restent intacts —
          ils ne sont pas modifiables, par choix.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setNoteASupprimer(null)} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!noteASupprimer) return;
              await supprimerNote(noteASupprimer);
              setNoteASupprimer(null);
              notifier("Note supprimée.");
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition"
          >
            Supprimer
          </button>
        </div>
      </Modal>

      {statutEnCours && (
        <StatutModal
          prospect={statutEnCours.prospect}
          statutCible={statutEnCours.cible}
          labels={STATUT_LABEL}
          logiciels={logiciels}
          onAjouterLogiciel={(nom) => ajouterLogiciel(currentUser?.uid ?? "", nom)}
          onSupprimerLogiciel={supprimerLogiciel}
          onClose={() => setStatutEnCours(null)}
          onValider={async (obs, logiciel) => {
            if (statutEnCours.cible) {
              await appliquerStatut(statutEnCours.prospect, statutEnCours.cible, obs, logiciel);
            } else {
              await ajouterNote(statutEnCours.prospect, obs);
            }
          }}
        />
      )}

      {annuaireOuvert && (
        <AnnuaireModal
          userId={currentUser?.uid ?? ""}
          metiers={metiers}
          existants={prospects}
          optouts={optouts}
          onClose={() => setAnnuaireOuvert(false)}
          onToast={notifier}
        />
      )}

      <Modal
        isOpen={!!aDetacher}
        onClose={() => setADetacher(null)}
        title="Détacher de la fiche client"
        size="sm"
      >
        <p className="text-sm text-gray-600">
          <strong>{aDetacher?.societe}</strong>
          {" ne sera plus rattaché à une fiche client. La fiche client elle-même n'est pas touchée."}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          À utiliser si la fiche a été supprimée, ou si le rattachement était une erreur.
          Le prospect redevient promouvable.
        </p>
        <label className="block text-xs font-medium text-gray-600 mt-4 mb-1">
          Statut à lui redonner
        </label>
        <select
          value={statutDetache}
          onChange={(e) => setStatutDetache(e.target.value as ProspectStatut)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        >
          {(Object.keys(STATUT_LABEL) as ProspectStatut[]).map((s) => (
            <option key={s} value={s}>{STATUT_LABEL[s]}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setADetacher(null)} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition">
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!aDetacher) return;
              await detacherDuClient(aDetacher, statutDetache);
              setADetacher(null);
              notifier("Prospect détaché — il peut être promu de nouveau.");
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Détacher
          </button>
        </div>
      </Modal>

      {aPromouvoir && (
        <PromotionModal
          prospect={aPromouvoir}
          userId={currentUser?.uid ?? ""}
          onClose={() => setAPromouvoir(null)}
          onToast={notifier}
          onFait={(clientId) => { setAPromouvoir(null); router.push(`/clients?id=${clientId}`); }}
        />
      )}

      {doublonsOuvert && (
        <DoublonsModal
          prospects={prospects}
          onClose={() => setDoublonsOuvert(false)}
          onToast={notifier}
        />
      )}

      {aAdapter && (
        <AdapterMailModal
          prospect={aAdapter.prospect}
          metier={aAdapter.metier}
          onClose={() => setAAdapter(null)}
          onToast={notifier}
        />
      )}

      {enrichOuvert && (
        <EnrichirModal
          prospects={prospects}
          metiers={metiers}
          onClose={() => setEnrichOuvert(false)}
          onToast={notifier}
        />
      )}

      {(ajoutOuvert || aEditer) && (
        <ProspectModal
          // `key` réinitialise les champs entre deux prospects édités d'affilée.
          key={aEditer?.id ?? "nouveau"}
          userId={currentUser?.uid ?? ""}
          metiers={metiers}
          existants={prospects}
          optouts={optouts}
          prospect={aEditer}
          onClose={() => { setAjoutOuvert(false); setAEditer(null); }}
          onToast={notifier}
        />
      )}

      {importOuvert && (
        <ImportModal
          userId={currentUser?.uid ?? ""}
          metiers={metiers}
          existants={prospects}
          optouts={optouts}
          onClose={() => setImportOuvert(false)}
          onToast={notifier}
        />
      )}

      {aEtudier && (
        <EtudeModal
          prospect={aEtudier}
          metier={metiers.find((m) => m.id === aEtudier.metierId) ?? null}
          onClose={() => setAEtudier(null)}
          onToast={notifier}
        />
      )}

      {aFusionner && aFusionner.length >= 2 && (
        <FusionModal
          groupe={aFusionner}
          onClose={() => setAFusionner(null)}
          onToast={notifier}
        />
      )}
    </div>
  );
}

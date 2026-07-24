"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AutoTextarea from "@/components/ui/AutoTextarea";
import { copyText } from "@/lib/clipboard";
import { enregistrerEnvoi } from "@/lib/mailingService";
import {
  DELAI_RELANCE_JOURS, MIN_PERSONNALISATION, QUOTA_JOUR, STATUT_LABEL, STATUT_STYLE,
  doublonSociete, peutContacter, estPrioritaireManuel, estPrioritaireAuto, destinatairesProspect,
} from "@/lib/mailingModel";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { estMailCourt } from "@/lib/mailingRender";
import { renderMailHtml, renderMailTexte, sujetMail, metierPourProspect } from "@/lib/mailingRender";
import AdapterMailModal from "@/components/mailing/AdapterMailModal";
import { construirePromptRecherche } from "@/lib/mailingPrompt";
import { GROUPES_EFFECTIF, groupeEffectif, type GroupeEffectif } from "@/lib/sirene";
import { departementDuCp } from "@/lib/territoires";
import FiltreRayon, { useRayon } from "@/components/mailing/FiltreRayon";
import { downloadBrochurePDF } from "@/lib/brochurePdf";
import type { MailingMetier, Prospect } from "@/types";

const inputCls = "w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition";

/** Pastille de filtre — un palier vide reste visible, en pointillés. */
function FiltreChip({
  actif, onClick, label, nombre, attenue,
}: {
  actif: boolean;
  onClick: () => void;
  label: string;
  nombre?: number;
  attenue?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
        actif
          ? "bg-blue-600 text-white"
          : attenue
            ? "border border-dashed text-gray-400 hover:bg-gray-50"
            : "border text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
      {nombre !== undefined && (
        <span className={`ml-1.5 ${actif ? "text-blue-100" : "text-gray-400"}`}>{nombre}</span>
      )}
    </button>
  );
}

export default function Composeur({
  userId, prospects, metiers, optouts, envoyesAujourdhui, onToast,
}: {
  userId: string;
  prospects: Prospect[];
  metiers: MailingMetier[];
  optouts: Set<string>;
  envoyesAujourdhui: number;
  onToast: (m: string) => void;
}) {
  const [metierId, setMetierId] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  /** File d'envoi : ids figés au lancement, parcourus un par un. */
  const [file, setFile] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [perso, setPerso] = useState("");
  const [copie, setCopie] = useState(false);
  const [confirmSansCopie, setConfirmSansCopie] = useState(false);
  const [promptOuvert, setPromptOuvert] = useState(false);
  const [promptCopie, setPromptCopie] = useState(false);
  const [brochureEnCours, setBrochureEnCours] = useState(false);
  const [filtre, setFiltre] = useState<"tous" | "jamais" | "relance">("tous");
  const [filtrePrio, setFiltrePrio] = useState<"tous" | "manuel" | "auto">("tous");
  const [filtreEffectif, setFiltreEffectif] = useState<GroupeEffectif | "tous">("tous");
  const [filtreDept, setFiltreDept] = useState<string>("tous");
  const rayon = useRayon(prospects);
  const [recherche, setRecherche] = useState("");

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const metier = metiers.find((m) => m.id === metierId) ?? null;

  /** Contactables du kit choisi : un envoi groupé n'a de sens qu'à métier constant. */
  const eligibles = useMemo(
    () =>
      prospects
        .filter((p) => (metierId ? p.metierId === metierId : false))
        .filter((p) => peutContacter(p, optouts).ok)
        // « Mes prioritaires » d'abord — je veux les prendre en premier —, puis alpha.
        .sort(
          (a, b) =>
            Number(estPrioritaireManuel(b)) - Number(estPrioritaireManuel(a)) ||
            a.societe.localeCompare(b.societe),
        ),
    [prospects, metierId, optouts],
  );

  const affiches = useMemo(
    () =>
      eligibles.filter((p) => {
        const dejaContacte = (p.nbEnvois ?? 0) > 0;
        if (filtre === "jamais" && dejaContacte) return false;
        if (filtre === "relance" && !dejaContacte) return false;
        if (filtrePrio === "manuel" && !estPrioritaireManuel(p)) return false;
        if (filtrePrio === "auto" && !estPrioritaireAuto(p, rayon.distance(p))) return false;
        if (filtreEffectif !== "tous" && groupeEffectif(p.effectifCode) !== filtreEffectif) return false;
        if (filtreDept !== "tous" && departementDuCp(p.codePostal)?.code !== filtreDept) return false;
        if (!rayon.dansRayon(p)) return false;
        const q = recherche.trim().toLowerCase();
        if (q && !`${p.societe} ${p.email} ${p.ville ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    [eligibles, filtre, filtrePrio, filtreEffectif, filtreDept, recherche, rayon],
  );

  // « Mes prioritaires » restent en tête ; ensuite, si un rayon est actif, les
  // plus proches d'abord (sinon l'ordre alpha hérité d'`eligibles`).
  const affichesTries = useMemo(
    () =>
      rayon.rayon === null
        ? affiches
        : [...affiches].sort(
            (a, b) =>
              Number(estPrioritaireManuel(b)) - Number(estPrioritaireManuel(a)) ||
              (rayon.distance(a) ?? 1e9) - (rayon.distance(b) ?? 1e9),
          ),
    [affiches, rayon],
  );

  /** Départements réellement présents dans le kit choisi — pas les 101. */
  const deptsDuKit = useMemo(() => {
    const par = new Map<string, { nom: string; n: number }>();
    for (const p of eligibles) {
      const d = departementDuCp(p.codePostal);
      if (!d) continue;
      const e = par.get(d.code) ?? { nom: d.nom, n: 0 };
      e.n++;
      par.set(d.code, e);
    }
    return [...par.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [eligibles]);

  const enFile = file.length > 0;
  const prospect = enFile ? prospects.find((p) => p.id === file[index]) ?? null : null;

  // À chaque nouveau prospect de la file, pré-remplir la personnalisation avec la
  // phrase issue de son étude (si elle existe) — sinon champ vide, à saisir.
  useEffect(() => {
    setPerso(prospect?.personnalisation ?? "");
    // Clé = l'identité du prospect courant ; ne pas dépendre de l'objet entier
    // (il change de référence à chaque snapshot Firestore et écraserait la saisie).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect?.id]);

  const blocage = prospect ? peutContacter(prospect, optouts) : null;
  const doublon = prospect ? doublonSociete(prospect, prospects) : null;
  const quotaAtteint = envoyesAujourdhui >= QUOTA_JOUR;
  const persoOk = perso.trim().length >= MIN_PERSONNALISATION;
  // Un kit au format court se suffit à lui-même : ses thèmes n'alimentent que la
  // brochure. Exiger une section remplie rendrait inutilisable un kit qui n'a
  // qu'un mail court (Carreleur, Paysagiste, Peintre, Plaquiste).
  const [adapterOuvert, setAdapterOuvert] = useState(false);

  const contenuOk =
    !!metier &&
    (estMailCourt(metier) ||
      (metier.sections ?? []).some((s) => s.afficher && s.problemeMail?.trim()));

  // Kit effectif : si ce prospect a un mail adapté, ses blocs priment sur le kit.
  const metierRendu = metier && prospect ? metierPourProspect(metier, prospect) : metier;

  const ctx = prospect && metierRendu && origin
    ? { metier: metierRendu, prospect, personnalisation: perso, origin }
    : null;

  // Le kit de BASE (pas le kit adapté) : le prompt doit proposer une adaptation
  // du mail type, pas une adaptation de l'adaptation précédente.
  // Adresses réellement écrites : principale + supplémentaires, sans les opposées
  const destinataires = prospect ? destinatairesProspect(prospect, optouts) : [];

  const promptRecherche = prospect ? construirePromptRecherche(prospect, metier) : "";
  const html = ctx ? renderMailHtml(ctx) : "";
  const texte = ctx ? renderMailTexte(ctx) : "";
  const sujet = prospect && metierRendu ? sujetMail(metierRendu, prospect) : "";
  const pret = !!ctx && contenuOk && !!blocage?.ok && !quotaAtteint;

  const basculer = (id: string) => {
    const n = new Set(selection);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelection(n);
  };

  const lancerFile = () => {
    const ids = eligibles.filter((p) => selection.has(p.id)).map((p) => p.id);
    if (!ids.length) return;
    setFile(ids);
    setIndex(0);
    setPerso("");
  };

  const suivant = () => {
    setPerso("");
    setCopie(false);
    setConfirmSansCopie(false);
    if (index + 1 >= file.length) {
      setFile([]);
      setIndex(0);
      setSelection(new Set());
      onToast("File terminée.");
    } else {
      setIndex(index + 1);
    }
  };

  const copierEtOuvrir = async () => {
    if (!ctx || !prospect) return;
    // Le presse-papier riche préserve la mise en forme au collage ; `mailto:` ne
    // transporte que du texte et tronque les corps longs.
    let ok = false;
    try {
      if (navigator.clipboard && "write" in navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([texte], { type: "text/plain" }),
          }),
        ]);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = await copyText(texte);
    setCopie(ok);
    // `assign()` plutôt qu'une affectation sur `location.href` : c'est équivalent,
    // mais la règle d'immutabilité du compilateur React interdit la seconde forme.
    // Plusieurs destinataires = une virgule (RFC 6068) : UN SEUL message part.
    window.location.assign(
      `mailto:${destinataires.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(sujet)}`,
    );
  };

  const marquerEnvoye = async () => {
    if (!ctx || !prospect || !metier) return;
    // Ce bouton n'envoie RIEN : il consigne un envoi fait à la main. Cliqué sans
    // avoir copié le message, il marque comme contacté un prospect qui n'a rien
    // reçu — et le rend intouchable pendant le délai de relance. Un second clic
    // vaut confirmation : on avertit, on ne bloque pas (l'envoi a pu se faire
    // depuis un autre appareil).
    if (!copie && !confirmSansCopie) {
      setConfirmSansCopie(true);
      return;
    }
    await enregistrerEnvoi(
      {
        userId,
        prospectId: prospect.id,
        societe: prospect.societe,
        metier: metier.metier,
        type: (prospect.nbEnvois ?? 0) > 0 ? "relance" : "initial",
        objet: sujet,
        corpsHtml: html,          // figé : jamais recalculé depuis le kit
        destinataires,            // figé aussi : à qui c'est VRAIMENT parti
        personnalisation: perso.trim(),
        canal: "brouillon",
      },
      prospect,
    );
    suivant();
  };

  const telechargerBrochure = async () => {
    if (!metier || !origin) return;
    setBrochureEnCours(true);
    try {
      await downloadBrochurePDF(metier, origin);
    } catch {
      onToast("La brochure n'a pas pu être générée.");
    } finally {
      setBrochureEnCours(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Sélection                                                        */
  /* ---------------------------------------------------------------- */

  if (!enFile) {
    const restant = Math.max(0, QUOTA_JOUR - envoyesAujourdhui);
    const trop = selection.size > restant;
    // Aperçu du message tel qu'il partira : premier sélectionné, sinon premier
    // de la liste comme échantillon.
    const modele = eligibles.find((p) => selection.has(p.id)) ?? affiches[0] ?? null;
    const ctxModele = modele && metier && origin
      ? { metier, prospect: modele, personnalisation: "", origin }
      : null;

    return (
      <div className="grid lg:grid-cols-2 gap-4 items-start">
      {/* `min-w-0` sur les colonnes : un enfant de grille vaut `min-width:auto`
          par défaut, donc un email ou une ville un peu longs élargissaient la
          grille au lieu d'être tronqués — d'où le débordement horizontal en
          mobile, avec le texte coupé par le bord de l'écran. */}
      <div className="space-y-3 min-w-0">
        <div className="border rounded-xl bg-white p-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Kit métier</label>
          <select
            value={metierId}
            onChange={(e) => { setMetierId(e.target.value); setSelection(new Set()); }}
            className={inputCls}
          >
            <option value="">— Choisir un métier —</option>
            {metiers.map((m) => (
              <option key={m.id} value={m.id}>{m.metier}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            Les envois se préparent par métier : le message vient du kit, il doit être le même
            pour toute la sélection.
          </p>
        </div>

        {metier && !contenuOk && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Ce kit n&apos;a ni mail court, ni thème affiché avec une accroche mail. Complète-le dans
            « Kits métier ».
          </div>
        )}

        {metierId && (
          <div className="border rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium">
                  {affiches.length} affiché{affiches.length > 1 ? "s" : ""}
                  <span className="text-gray-400 font-normal"> sur {eligibles.length} contactables</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelection(new Set(affiches.slice(0, restant).map((p) => p.id)))}
                    className="text-xs text-blue-700 hover:underline"
                  >
                    Tout cocher (max {restant})
                  </button>
                  <button
                    onClick={() => setSelection(new Set())}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    Vider
                  </button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Rechercher…"
                  className="flex-1 min-w-40 border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition"
                />
                {([
                  { k: "tous", l: "Tous" },
                  { k: "jamais", l: "Jamais contactés" },
                  { k: "relance", l: "À relancer" },
                ] as const).map((f) => (
                  <button
                    key={f.k}
                    onClick={() => setFiltre(f.k)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                      filtre === f.k ? "bg-blue-600 text-white" : "border hover:bg-gray-50 text-gray-600"
                    }`}
                  >
                    {f.l}
                  </button>
                ))}
                {(() => {
                  const nManuel = eligibles.filter(estPrioritaireManuel).length;
                  const nAuto = eligibles.filter((p) => estPrioritaireAuto(p, rayon.distance(p))).length;
                  const bascule = (v: "manuel" | "auto") =>
                    setFiltrePrio((c) => (c === v ? "tous" : v));
                  return (
                    <>
                      <button
                        onClick={() => bascule("manuel")}
                        title="Mes prioritaires — marqués à la main, à contacter en premier"
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                          filtrePrio === "manuel" ? "bg-amber-500 text-white" : "border hover:bg-amber-50 text-gray-600"
                        }`}
                      >
                        <StarSolid className={`w-3.5 h-3.5 ${filtrePrio === "manuel" ? "text-white" : "text-amber-500"}`} />
                        Mes prioritaires
                        <span className={filtrePrio === "manuel" ? "text-amber-100" : "text-gray-400"}>{nManuel}</span>
                      </button>
                      <button
                        onClick={() => bascule("auto")}
                        title="Suggestions automatiques (score)"
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                          filtrePrio === "auto" ? "bg-sky-600 text-white" : "border hover:bg-sky-50 text-gray-600"
                        }`}
                      >
                        <SparklesIcon className={`w-3.5 h-3.5 ${filtrePrio === "auto" ? "text-white" : "text-sky-600"}`} />
                        Auto
                        <span className={filtrePrio === "auto" ? "text-sky-100" : "text-gray-400"}>{nAuto}</span>
                      </button>
                    </>
                  );
                })()}
              </div>

              {/* Ciblage fin dans le kit choisi. Les compteurs portent sur les
                  CONTACTABLES du kit, pas sur toute la base : un palier à 0 ici
                  veut dire « rien à envoyer », pas « aucun prospect ». */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <FiltreChip
                  actif={filtreEffectif === "tous"}
                  onClick={() => setFiltreEffectif("tous")}
                  label="Toutes tailles"
                />
                {GROUPES_EFFECTIF.map((g) => {
                  const n = eligibles.filter((p) => groupeEffectif(p.effectifCode) === g.id).length;
                  return (
                    <FiltreChip
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

              <div className="mt-2">
                <FiltreRayon {...rayon} />
              </div>

              {deptsDuKit.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <FiltreChip
                    actif={filtreDept === "tous"}
                    onClick={() => setFiltreDept("tous")}
                    label="Tous départements"
                  />
                  {deptsDuKit.map(([code, d]) => (
                    <FiltreChip
                      key={code}
                      actif={filtreDept === code}
                      onClick={() => setFiltreDept(code)}
                      label={`${code} ${d.nom}`}
                      nombre={d.n}
                    />
                  ))}
                </div>
              )}
            </div>

            {affichesTries.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                {eligibles.length === 0
                  ? "Aucun prospect contactable pour ce métier — délai de relance non écoulé, quota épuisé, ou liste vide."
                  : "Aucun résultat avec ces filtres."}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y">
                {affichesTries.map((p) => {
                  const nb = p.nbEnvois ?? 0;
                  return (
                    <label key={p.id} className="flex items-start gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selection.has(p.id)}
                        onChange={() => basculer(p.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {estPrioritaireManuel(p) && (
                            <StarSolid className="w-3.5 h-3.5 shrink-0 text-amber-500" title="Mes prioritaires — à contacter en premier" />
                          )}
                          {!estPrioritaireManuel(p) && estPrioritaireAuto(p, rayon.distance(p)) && (
                            <SparklesIcon className="w-3.5 h-3.5 shrink-0 text-sky-600" title="Suggéré par le score auto" />
                          )}
                          <span className="text-sm font-medium truncate">{p.societe}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${STATUT_STYLE[p.statut]}`}>
                            {STATUT_LABEL[p.statut]}
                          </span>
                          {nb > 0 ? (
                            <span
                              className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-50 text-indigo-700"
                              title={`Dernier envoi le ${p.dernierEnvoiAt?.toDate().toLocaleDateString("fr-FR")}`}
                            >
                              {nb} envoi{nb > 1 ? "s" : ""} · relance
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-green-50 text-green-700">
                              jamais contacté
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {p.email}
                          {p.ville ? ` · ${p.ville}` : ""}
                          {p.dernierEnvoiAt
                            ? ` · dernier envoi ${p.dernierEnvoiAt.toDate().toLocaleDateString("fr-FR")}`
                            : ""}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {trop && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Il ne reste que {restant} envoi(s) avant le plafond quotidien de {QUOTA_JOUR}.
            Réduis la sélection, ou termine demain.
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={telechargerBrochure}
            disabled={!metier || brochureEnCours}
            className="px-4 py-2.5 rounded-lg border text-sm font-medium hover:bg-gray-50 transition disabled:opacity-40"
          >
            {brochureEnCours ? "Génération…" : "Brochure (PDF)"}
          </button>
          <button
            onClick={lancerFile}
            disabled={selection.size === 0 || quotaAtteint || !contenuOk}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Préparer {selection.size || ""} envoi{selection.size > 1 ? "s" : ""}
          </button>
        </div>
      </div>

        <div className="border rounded-xl bg-white overflow-hidden flex flex-col lg:sticky lg:top-4">
          <div className="px-4 py-2.5 border-b">
            <div className="text-xs text-gray-500">
              Aperçu {modele ? `— ${modele.societe}` : ""}
            </div>
            <div className="text-sm font-medium truncate">
              {modele && metier ? sujetMail(metier, modele) : "Choisis un métier"}
            </div>
          </div>
          {ctxModele ? (
            <>
              <iframe
                title="Aperçu du mail"
                srcDoc={renderMailHtml(ctxModele)}
                className="w-full flex-1 min-h-[28rem] bg-white"
                sandbox=""
              />
              <div className="px-4 py-2 border-t text-[11px] text-gray-500">
                Aperçu sans personnalisation — tu l&apos;ajouteras prospect par prospect.
              </div>
            </>
          ) : (
            <div className="px-4 py-16 text-center text-sm text-gray-500">
              Sélectionne un kit métier pour voir le message.
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* File d'envoi                                                     */
  /* ---------------------------------------------------------------- */

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3 min-w-0">
        <div className="border rounded-xl bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-gray-500">
                Envoi {index + 1} sur {file.length}
              </div>
              <div className="text-base font-semibold">{prospect?.societe}</div>
              <div className="text-xs text-gray-500">
                {destinataires.join(", ") || prospect?.email}
                {destinataires.length > 1 && (
                  <span className="ml-1 text-gray-400">
                    ({destinataires.length} destinataires, un seul message)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { setFile([]); setIndex(0); }}
              className="text-xs text-gray-500 hover:underline shrink-0"
            >
              Quitter la file
            </button>
          </div>

          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${(index / file.length) * 100}%` }}
            />
          </div>

          {/* L'étude précède la personnalisation, et se trouve donc juste avant
              le champ qu'elle sert à remplir. */}
          <div className="border rounded-lg bg-gray-50/70">
            <button
              onClick={() => setPromptOuvert(!promptOuvert)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 transition rounded-lg"
            >
              <span>Étudier cette entreprise avant d&apos;écrire</span>
              <span className="text-gray-400">{promptOuvert ? "Masquer" : "Afficher le prompt"}</span>
            </button>
            {promptOuvert && (
              <div className="px-3 pb-3">
                <p className="text-[11px] text-gray-500 mb-2">
                  Copie ce prompt dans Claude (ou un autre assistant avec accès au web) : il reprend
                  déjà tout ce que l&apos;app sait de <strong>{prospect?.societe}</strong> et demande
                  ce qu&apos;elle ignore — effectif réel, organisation, logiciel en place, avis
                  clients — en exigeant des sources. Il finit par une phrase de personnalisation
                  prête à coller ci-dessous.
                </p>
                <pre className="text-[11px] leading-relaxed bg-white border rounded-lg p-2.5 max-h-52 overflow-auto whitespace-pre-wrap font-sans text-gray-700">
                  {promptRecherche}
                </pre>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={async () => {
                      setPromptCopie(await copyText(promptRecherche));
                      setTimeout(() => setPromptCopie(false), 2500);
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-white transition"
                  >
                    {promptCopie ? "Copié ✓" : "Copier le prompt"}
                  </button>
                  <span className="text-[11px] text-amber-700">
                    Vérifie ce qu&apos;il te renvoie : une information inventée dans un premier mail
                    se retourne contre toi.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Réécrire le mail pour CETTE entreprise, à partir de l'étude ci-dessus */}
          {prospect && metier && estMailCourt(metier) && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setAdapterOuvert(true)}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-gray-50 transition"
              >
                {prospect.mailPerso ? "Modifier le mail adapté" : "Adapter le mail à ce prospect"}
              </button>
              {prospect.mailPerso && (
                <span className="text-[11px] bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
                  Mail adapté — le kit métier n&apos;est pas utilisé pour lui
                </span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Ligne de personnalisation <span className="text-gray-400">(recommandé)</span>
            </label>
            <AutoTextarea
              value={perso}
              onChange={setPerso}
              minRows={3}
              placeholder="Une phrase propre à cette entreprise : ce que tu as vu sur leur site, un chantier, une actualité…"
              className={inputCls}
            />
            <div className="flex justify-between text-[11px] mt-1">
              <span className="text-gray-500">
                Si tu ne peux rien écrire de spécifique, passe au suivant.
              </span>
              <span className={persoOk ? "text-green-600" : "text-gray-400"}>
                {perso.trim().length}/{MIN_PERSONNALISATION}
              </span>
            </div>
          </div>
        </div>

        {blocage && !blocage.ok && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">{blocage.raison}</div>
        )}
        {doublon && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Déjà contacté chez ce même employeur : <strong>{doublon.societe}</strong>.
          </div>
        )}
        {quotaAtteint && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Plafond quotidien atteint ({QUOTA_JOUR} envois). Reprends demain.
          </div>
        )}

        {/* L'app n'envoie aucun mail : elle prépare le message et consigne
            l'envoi. Les étapes sont rappelées ici parce que le raccourci
            « le bouton vert envoie » est le réflexe naturel — et faux. */}
        <ol className="text-xs text-gray-600 space-y-1 border-l-2 border-gray-200 pl-3">
          <li>
            <span className="font-medium text-gray-800">1.</span> Copier le message et ouvrir le
            brouillon dans ta messagerie.
          </li>
          <li>
            <span className="font-medium text-gray-800">2.</span> Coller (Ctrl+V), joindre la
            brochure si tu le souhaites, puis <strong>envoyer depuis ta messagerie</strong>.
          </li>
          <li>
            <span className="font-medium text-gray-800">3.</span> Revenir ici pour enregistrer
            l&apos;envoi et passer au prospect suivant.
          </li>
        </ol>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={copierEtOuvrir}
            disabled={!pret}
            className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copie ? "Copié ✓ — colle dans le brouillon" : "1 · Copier et ouvrir le brouillon"}
          </button>
          <button
            onClick={marquerEnvoye}
            disabled={!pret}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
              confirmSansCopie
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
            title="N'envoie pas le mail : enregistre un envoi que tu as fait depuis ta messagerie."
          >
            {confirmSansCopie
              ? "Confirmer : je l'ai bien envoyé"
              : "3 · Je l'ai envoyé — enregistrer"}
          </button>
          <button
            onClick={suivant}
            className="px-4 py-2.5 rounded-lg border text-sm font-medium hover:bg-gray-50 transition"
          >
            Passer
          </button>
        </div>
        {confirmSansCopie && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            Tu n&apos;as pas copié ce message. Si tu l&apos;as réellement envoyé depuis ta
            messagerie, confirme ; sinon reprends à l&apos;étape 1 — enregistrer un envoi qui
            n&apos;a pas eu lieu rend ce prospect intouchable pendant {DELAI_RELANCE_JOURS} jours.
          </div>
        )}
        <p className="text-[11px] text-gray-500">
          Enregistrer archive le message tel qu&apos;il est parti et enchaîne sur le suivant.
          « Passer » ne consigne rien. Un envoi consigné par erreur se défait depuis la liste
          des prospects (↩).
        </p>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden flex flex-col min-w-0">
        <div className="px-4 py-2.5 border-b">
          <div className="text-xs text-gray-500">Objet</div>
          <div className="text-sm font-medium truncate">{sujet || "—"}</div>
        </div>
        {ctx ? (
          <iframe
            title="Aperçu du mail"
            srcDoc={html}
            className="w-full flex-1 min-h-[32rem] bg-white"
            sandbox=""
          />
        ) : (
          <div className="px-4 py-16 text-center text-sm text-gray-500">Aperçu indisponible.</div>
        )}
      </div>

      {adapterOuvert && prospect && metier && (
        <AdapterMailModal
          prospect={prospect}
          metier={metier}
          onClose={() => setAdapterOuvert(false)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

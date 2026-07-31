// Template d'email pour l'envoi d'une facture / devis.
// La version HTML est prête pour un envoi serveur (SendGrid / Resend) — voir lib/sendInvoice.ts.
// La version texte est utilisée par le bouton "Email" (mailto:) en attendant.
//
// Parti pris (2026-07-31) : le document part TOUJOURS en pièce jointe manuelle → aucun lien
// vers le PDF dans le corps. Pas non plus de bloc de coordonnées ni de nom en signature :
// la signature du client mail (logo + Teddy) s'en charge, sinon on fait doublon.

export interface InvoiceEmailVars {
  clientName: string;      // "NOM Prénom"
  docLabel: string;        // "Facture" | "Devis"
  number: string;          // ex: FAC_001_010126
  isDevis?: boolean;
  montant?: string;        // total formaté, ex "1 200,00 €" (pas de mention TTC : TVA non applicable, art. 293 B)
  dateEcheance?: string;   // facture : date d'échéance formatée fr-FR
  validiteJours?: number;  // devis : durée de validité
  signLink?: string;       // devis : lien de signature en ligne
}

const TEL = "+33 6 79 40 82 54";
const MAIL = "contact@enezo.fr";

const hasValue = (s?: string) => !!s && s.trim() !== "" && s.trim() !== "—";

/** « Vous trouverez ci-joint la facture FAC_001, d'un montant de 1 200,00 €, à régler pour le 01 août 2026. » */
function phraseDocument({ isDevis, docLabel, number, montant, dateEcheance }: InvoiceEmailVars): string {
  let p = `Vous trouverez ci-joint ${isDevis ? "le" : "la"} ${docLabel.toLowerCase()} ${number}`;
  if (hasValue(montant)) p += `, d'un montant de ${montant}`;
  if (!isDevis && hasValue(dateEcheance)) p += `, à régler pour le ${dateEcheance}`;
  return `${p}.`;
}

/**
 * Paragraphes qui suivent la phrase d'accroche (validité + signature en ligne pour un devis,
 * rappel de règlement pour une facture). Un paragraphe peut tenir sur deux lignes (`\n`).
 */
function paragraphesSuite({ isDevis, validiteJours, signLink }: InvoiceEmailVars): string[] {
  if (!isDevis) {
    return ["Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message."];
  }
  const validite = validiteJours ? `Il est valable ${validiteJours} jours.` : "";
  if (hasValue(signLink)) {
    return [`${validite}${validite ? " " : ""}Vous pouvez le consulter et le signer en ligne :\n${signLink}`];
  }
  return validite ? [validite] : [];
}

export function buildInvoiceEmailHtml(vars: InvoiceEmailVars): string {
  const suite = paragraphesSuite(vars)
    .map((p) => {
      const lignes = p.split("\n").map((l) => (l === vars.signLink ? `<a href="${l}" style="color:#1a73e8;">${l}</a>` : l));
      return `<div class="section">${lignes.join("<br>")}</div>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, table, td, a { margin: 0; padding: 0; border: 0; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; display: block; }
    table { border-collapse: collapse !important; }
    body { font-family: Arial, sans-serif; padding: 40px; color: black; background-color: #ffffff; font-size: 13px; }
    .section { margin-top:10px; margin-bottom:10px; }
  </style>
</head>
<body>

<div class="section">Bonjour ${vars.clientName},</div>

<div class="section">${phraseDocument(vars)}</div>
${suite}

<div class="section">Je reste à votre disposition.</div>

<div class="section">Cordialement,</div>
<br>

<table cellpadding="0" cellspacing="0" border="0" style="vertical-align: middle; font-size: medium; font-family: Arial; min-width: 375px; width: 100%;">
  <tbody>
    <tr>
      <td style="text-align: center;">
        <img src="https://drive.google.com/thumbnail?id=1o_AiTLSFIXoEsmr7YKdJT7oGxPcv_I_l" width="130" style="max-width: 130px; display: inline-block;" alt="Logo">
      </td>
    </tr>
    <tr><td height="10"></td></tr>
    <tr>
      <td style="text-align: center;">
        <h2 style="margin: 0; font-size: 18px; color: #000001; font-weight: 600;">Enezo</h2>
      </td>
    </tr>
    <tr>
      <td style="padding: 30px 0;">
        <hr style="border: 0; border-bottom: 1px solid #000001; margin: 0;">
      </td>
    </tr>
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial;">
          <tbody>
            <tr>
              <td>
                <table cellpadding="0" cellspacing="0" style="font-family: Arial;">
                  <tr style="height: 25px;">
                    <td width="30"><img src="https://drive.google.com/thumbnail?id=11QxuNd6t3ZnPyEpaF-AYRICvAdAa6KmY" alt="telephone" width="20"></td>
                    <td><a href="tel:+33679408254" style="text-decoration: none; color: #000001; font-size: 14px;">${TEL}</a></td>
                  </tr>
                  <tr style="height: 25px;">
                    <td width="30"><img src="https://drive.google.com/thumbnail?id=1k-67I-BTJChKh2qw7a-RW2p4ro9ebXZa" alt="email" width="20"></td>
                    <td><a href="mailto:${MAIL}" style="text-decoration: none; color: #000001; font-size: 14px;">${MAIL}</a></td>
                  </tr>
                </table>
              </td>
              <td style="text-align: right;">
                <a href="https://www.facebook.com/share/14SVaPgDpL/?mibextid=wwXIfr" style="display: inline-block; margin-right: 5px;"><img src="https://drive.google.com/thumbnail?id=1keeN2l14ufTvY5hHUQOGJwSADT-9KWhg" width="24" style="border-radius: 50%;"></a>
                <a href="https://www.instagram.com/enezo.officiel/" style="display: inline-block; margin-right: 5px;"><img src="https://drive.google.com/thumbnail?id=14oeulhQPW-JDld8qJSorg5m6IcM7EX5z" width="24" style="border-radius: 50%;"></a>
                <a href="https://wa.me/33679408254" style="display: inline-block;"><img src="https://drive.google.com/thumbnail?id=1yJQUZRvuNFRBZhvTlo341nF5R6SmSpLy" width="24" style="border-radius: 50%;"></a>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 30px 0;">
        <hr style="border: 0; border-bottom: 1px solid #000001; margin: 0;">
      </td>
    </tr>
    <tr>
      <td style="text-align: center; font-size: 12px; max-width: 300px; margin: auto; padding-top: 1rem;">
        <p style="margin: 0;">&copy; ${new Date().getFullYear()} Enezo</p>
      </td>
    </tr>
  </tbody>
</table>

</body>
</html>`;
}

// Version texte (mailto:) — même structure, sans HTML
export function buildInvoiceEmailText(vars: InvoiceEmailVars): string {
  return [
    `Bonjour ${vars.clientName},`,
    ``,
    phraseDocument(vars),
    ...paragraphesSuite(vars).flatMap((p) => [``, p]),
    ``,
    `Je reste à votre disposition.`,
    ``,
    `Cordialement,`,
  ].join("\n");
}

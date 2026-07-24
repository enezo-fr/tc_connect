import type { Metadata, Viewport } from 'next'
import { Inter, Montserrat } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { BrandProvider } from '@/context/BrandContext'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'
import { hostToBrand, DEFAULT_BRAND } from '@/lib/brand'

const inter = Inter({ subsets: ['latin'] })
// Montserrat = police des titres pour la marque Enezo (charte). Exposée en variable CSS,
// appliquée aux titres uniquement sous [data-brand="enezo"] (cf. globals.css). Coaching = Inter.
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', display: 'swap' })

export const viewport: Viewport = {
  themeColor: '#737374',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export async function generateMetadata(): Promise<Metadata> {
  // Nom dépendant du DOMAINE : « Enezo » sur app.enezo.fr, « TC Connect » ailleurs (coaching inchangé).
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host')
  const isEnezo = hostToBrand(host) === 'enezo'
  const nom = isEnezo ? 'Enezo' : 'TC Connect'
  // Icônes (onglet + écran d'accueil iOS) dépendantes du domaine.
  // Enezo : `-full` = logo complet (ENEZO + cible) ; retirer le suffixe rend la
  // cible seule, qui reste bien plus lisible à 60 px sur un écran d'accueil.
  const appleTouch = isEnezo ? '/enezo-apple-touch-icon-full.png' : '/apple-touch-icon.png'
  return {
    title: nom,
    description: 'Application de gestion pour coachs sportifs',
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: nom,
      startupImage: appleTouch,
    },
    icons: {
      icon: isEnezo
        ? [{ url: '/enezo-favicon-96x96.png', sizes: '96x96', type: 'image/png' }]
        : [
            { url: '/favicon.ico', sizes: '48x48' },
            { url: '/favicon.svg', type: 'image/svg+xml' },
            { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
          ],
      apple: [
        { url: appleTouch, sizes: '180x180', type: 'image/png' },
      ],
    },
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Résolution de la marque par le DOMAINE, côté serveur : le host détermine
  // l'habillage d'entrée AVANT connexion (thème + login), sans flash.
  // enezo.fr → 'enezo' ; tout le reste (URL Vercel actuelle…) → défaut coaching.
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host')
  const brand = hostToBrand(host) ?? DEFAULT_BRAND

  return (
    <html lang="fr" data-brand={brand}>
      <body className={`${inter.className} ${montserrat.variable}`}>
        <AuthProvider>
          <BrandProvider initialBrand={brand}>
            <ServiceWorkerRegister />
            {children}
          </BrandProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
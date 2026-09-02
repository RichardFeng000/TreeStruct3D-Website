import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ruiding-feng.com/TreeStruct3D-Website/'),
  title: 'TreeStruct3D — Structural Editability for Agentic 3D Modeling',
  description:
    'TreeStruct3D generates editable Blender programs with explicit semantic parts, directed attachments, and geometry-derived shared anchors.',
  alternates: {
    canonical: 'https://www.ruiding-feng.com/TreeStruct3D-Website/',
  },
  icons: {
    icon: [
      {
        url: 'https://www.ruiding-feng.com/TreeStruct3D-Website/favicon.png',
        type: 'image/png',
        sizes: '128x128',
      },
    ],
  },
  openGraph: {
    type: 'website',
    url: 'https://www.ruiding-feng.com/TreeStruct3D-Website/',
    siteName: 'TreeStruct3D',
    title: 'TreeStruct3D — Structural Editability for Agentic 3D Modeling',
    description:
      'Generate editable Blender programs with explicit semantic parts, directed attachments, and geometry-derived shared anchors.',
    images: [
      {
        url: 'https://www.ruiding-feng.com/TreeStruct3D-Website/og.png',
        width: 1200,
        height: 630,
        alt: 'TreeStruct3D — Structural Editability for Agentic 3D Modeling',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TreeStruct3D — Structural Editability for Agentic 3D Modeling',
    description:
      'Generate editable Blender programs with explicit semantic parts, directed attachments, and geometry-derived shared anchors.',
    images: ['https://www.ruiding-feng.com/TreeStruct3D-Website/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

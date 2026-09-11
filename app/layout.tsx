import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './paper.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ruiding-feng.com/treeStruct3D/'),
  title: 'TreeStruct3D — Structural Editability in Procedural 3D Modeling',
  description:
    'From text to editable Blender programs: predicted part trees, geometry-derived anchors, and attachment validation with targeted repair.',
  alternates: {
    canonical: 'https://www.ruiding-feng.com/treeStruct3D/',
  },
  icons: {
    icon: [
      {
        url: 'https://www.ruiding-feng.com/treeStruct3D/favicon.png',
        type: 'image/png',
        sizes: '128x128',
      },
    ],
  },
  openGraph: {
    type: 'website',
    url: 'https://www.ruiding-feng.com/treeStruct3D/',
    siteName: 'TreeStruct3D',
    title: 'TreeStruct3D — Structural Editability in Procedural 3D Modeling',
    description:
      'Learn how part trees, geometry-derived anchors, and validation-guided repair support editable 3D programs.',
    images: [
      {
        url: 'https://www.ruiding-feng.com/treeStruct3D/og.png',
        width: 1200,
        height: 630,
        alt: 'TreeStruct3D — Structural Editability in Procedural 3D Modeling',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TreeStruct3D — Structural Editability in Procedural 3D Modeling',
    description:
      'Learn how part trees, geometry-derived anchors, and validation-guided repair support editable 3D programs.',
    images: ['https://www.ruiding-feng.com/treeStruct3D/og.png'],
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

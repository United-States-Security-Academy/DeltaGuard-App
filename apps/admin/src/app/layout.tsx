import { APP_NAME, COMPANY_NAME } from '@deltaguard/shared';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { THEME_SCRIPT } from '@/components/theme';

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
  title: `${APP_NAME} Admin`,
  description: `Internal admin console for ${COMPANY_NAME}`,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-theme is set by THEME_SCRIPT before first paint, hence suppressHydrationWarning.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

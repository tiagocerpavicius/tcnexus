import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TCNexus',
  description: 'Dashboard de inversiones',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

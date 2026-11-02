import type { Metadata, Viewport } from 'next';
import '@fontsource/anuphan/thai-400.css';
import '@fontsource/anuphan/thai-500.css';
import '@fontsource/anuphan/latin-400.css';
import '@fontsource/anuphan/latin-500.css';
import '@fontsource/chakra-petch/thai-500.css';
import '@fontsource/chakra-petch/thai-600.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import './globals.css';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = {
  title: { default: 'Cue — ระบบร้านสนุ๊กเกอร์', template: '%s · Cue' },
  description: 'จองโต๊ะสนุ๊กเกอร์ ดูสถานะโต๊ะ และจัดการร้าน',
};

export const viewport: Viewport = { themeColor: '#0e6b43', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth';
import { AuctioneerPage } from '@/pages/auctioneer';
import { AuditPage } from '@/pages/audit';
import { LotPage } from '@/pages/lot';
import { ShowcasePage } from '@/pages/showcase';
import { LoginPage } from '@/pages/login';
import { WalletPage } from '@/pages/wallet';
import { AppLayout } from './AppLayout';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<ShowcasePage />} />
            <Route path="lotes/:id" element={<LotPage />} />
            <Route path="auditoria/:id" element={<AuditPage />} />
            <Route path="leiloeiro" element={<AuctioneerPage />} />
            <Route path="entrar" element={<LoginPage />} />
            <Route path="carteira" element={<WalletPage />} />
            <Route path="*" element={<p>Página não encontrada.</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

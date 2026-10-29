import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth';
import { AuctioneerPage } from '@/pages/auctioneer';
import { NewLotPage } from '@/pages/new-lot';
import { AuditPage } from '@/pages/audit';
import { LotPage } from '@/pages/lot';
import { ShowcasePage } from '@/pages/showcase';
import { LoginPage } from '@/pages/login';
import { WalletPage } from '@/pages/wallet';
import { ReceiptPage } from '@/pages/receipt';
import { WinsPage } from '@/pages/wins';
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
            <Route path="leiloeiro/novo" element={<NewLotPage />} />
            <Route path="entrar" element={<LoginPage />} />
            <Route path="carteira" element={<WalletPage />} />
            <Route path="arremates" element={<WinsPage />} />
            <Route path="comprovante/:code" element={<ReceiptPage />} />
            <Route
              path="*"
              element={(
                <section>
                  <h1>Página não encontrada</h1>
                  <p>O endereço não existe ou mudou.</p>
                  <Link to="/">Voltar aos lotes</Link>
                </section>
              )}
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

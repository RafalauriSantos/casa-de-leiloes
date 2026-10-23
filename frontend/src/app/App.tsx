import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { WalletPage } from '@/pages/wallet';
import { AppLayout } from './AppLayout';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="entrar" element={<LoginPage />} />
            <Route path="carteira" element={<WalletPage />} />
            <Route path="*" element={<p>Página não encontrada.</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

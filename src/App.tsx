import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import { DashboardLayout } from "./layouts/DashboardLayout";
import DashboardHome from "./pages/dashboard/DashboardHome";
import IntegrationPage from "./pages/dashboard/IntegrationPage";
import DatabasePage from "./pages/dashboard/DatabasePage";
import ControlPage from "./pages/dashboard/ControlPage";
import ProductsPage from "./pages/dashboard/ProductsPage";
import AdsPage from "./pages/dashboard/AdsPage";
import ResellerPage from "./pages/dashboard/ResellerPage";
import ProfilePage from "./pages/dashboard/ProfilePage";
import PaymentPage from "./pages/dashboard/PaymentPage";
import AdminPage from "./pages/dashboard/AdminPage";
import PlatformSelection from "./pages/dashboard/PlatformSelection";
import SettingsPage from "./pages/dashboard/SettingsPage";
import SessionManager from "./pages/dashboard/whatsapp/SessionManager";
import { WhatsAppProvider } from "./context/WhatsAppContext";
import { Outlet, useParams } from "react-router-dom";

// Wrapper to inject WhatsApp Context only for WhatsApp routes
const WhatsAppWrapper = () => {
  const { platform } = useParams();
  if (platform === 'whatsapp') {
    return (
      <WhatsAppProvider>
        <Outlet />
      </WhatsAppProvider>
    );
  }
  return <Outlet />;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          {/* Dashboard Routes */}
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<PlatformSelection />} />
            
            {/* Platform Specific Routes */}
            <Route path=":platform" element={<Outlet />}>
              <Route index element={<DashboardHome />} />
              <Route path="integration" element={<IntegrationPage />} />
              <Route path="sessions" element={<SessionManager />} />
              <Route path="database" element={<DatabasePage />} />
              <Route path="control" element={<ControlPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="ads" element={<AdsPage />} />
              <Route path="reseller" element={<ResellerPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="payment" element={<PaymentPage />} />
              <Route path="admin" element={<AdminPage />} />
            </Route>

            {/* Direct access to generic pages (optional, but good for backward compat if needed) */}
             <Route path="profile" element={<ProfilePage />} />
          </Route>
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

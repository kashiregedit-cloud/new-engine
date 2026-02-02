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
import WhatsAppDatabasePage from "./pages/dashboard/whatsapp/WhatsAppDatabasePage";
import WhatsAppControlPage from "./pages/dashboard/whatsapp/WhatsAppControlPage";
import ProductsPage from "./pages/dashboard/ProductsPage";
import AdsPage from "./pages/dashboard/AdsPage";
import ResellerPage from "./pages/dashboard/ResellerPage";
import ProfilePage from "./pages/dashboard/ProfilePage";
import PaymentPage from "./pages/dashboard/PaymentPage";
import AdminPage from "./pages/dashboard/AdminPage";
import PlatformSelection from "./pages/dashboard/PlatformSelection";
import SettingsPage from "./pages/dashboard/SettingsPage";
import WhatsAppOrderTrackingPage from "./pages/dashboard/whatsapp/WhatsAppOrderTrackingPage";
import SessionManager from "./pages/dashboard/whatsapp/SessionManager";
import WhatsAppSettingsPage from "./pages/dashboard/whatsapp/WhatsAppSettingsPage";
import MessengerIntegrationPage from "./pages/dashboard/messenger/MessengerIntegrationPage";
import MessengerControlPage from "./pages/dashboard/messenger/MessengerControlPage";
import MessengerOrderTrackingPage from "./pages/dashboard/messenger/MessengerOrderTrackingPage";
import MessengerSettingsPage from "./pages/dashboard/messenger/MessengerSettingsPage";
import MessengerDatabasePage from "./pages/dashboard/messenger/MessengerDatabasePage";
import MessengerConversionPage from "./pages/dashboard/messenger/MessengerConversionPage";
import { WhatsAppProvider } from "./context/WhatsAppContext";
import ApiManagementPage from "./pages/dashboard/ApiManagementPage";
import { Outlet, useParams } from "react-router-dom";

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
            <Route path="abcadmin" element={<AdminPage />} />
            <Route path="api-management" element={<ApiManagementPage />} />
            
            {/* Global Tools Routes (Direct access) */}
            <Route path="products" element={<ProductsPage />} />
            <Route path="ads" element={<AdsPage />} />
            <Route path="reseller" element={<ResellerPage />} />
            <Route path="payment" element={<PaymentPage />} />
            <Route path="profile" element={<ProfilePage />} />

            {/* WhatsApp Routes */}
            <Route path="whatsapp" element={<Outlet />}>
              <Route index element={<DashboardHome />} />
              <Route path="sessions" element={<SessionManager />} />
              <Route path="control" element={<WhatsAppControlPage />} />
              <Route path="orders" element={<WhatsAppOrderTrackingPage />} />
              <Route path="database" element={<WhatsAppDatabasePage />} />
              <Route path="settings" element={<WhatsAppSettingsPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="ads" element={<AdsPage />} />
              <Route path="reseller" element={<ResellerPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="payment" element={<PaymentPage />} />
            </Route>

            {/* Messenger Routes */}
            <Route path="messenger" element={<Outlet />}>
              <Route index element={<DashboardHome />} />
              <Route path="integration" element={<MessengerIntegrationPage />} />
              <Route path="control" element={<MessengerControlPage />} />
              <Route path="orders" element={<MessengerOrderTrackingPage />} />
              <Route path="conversion" element={<MessengerConversionPage />} />
              <Route path="database" element={<MessengerDatabasePage />} />
              <Route path="settings" element={<MessengerSettingsPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="ads" element={<AdsPage />} />
              <Route path="reseller" element={<ResellerPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="payment" element={<PaymentPage />} />
            </Route>

            {/* Platform Specific Routes (Fallback) */}
            <Route path=":platform" element={<Outlet />}>
              <Route index element={<DashboardHome />} />
              <Route path="integration" element={<IntegrationPage />} />
              <Route path="sessions" element={<SessionManager />} />
              <Route path="database" element={<WhatsAppDatabasePage />} />
              <Route path="control" element={<WhatsAppControlPage />} />
              <Route path="settings" element={<WhatsAppSettingsPage />} />
              <Route path="orders" element={<WhatsAppOrderTrackingPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="ads" element={<AdsPage />} />
              <Route path="reseller" element={<ResellerPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="payment" element={<PaymentPage />} />
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

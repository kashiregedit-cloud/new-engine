import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { WhatsAppProvider } from "@/context/WhatsAppContext";
import { MessengerProvider } from "@/context/MessengerContext";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/integration": "Integration",
  "/dashboard/database": "Database Connect",
  "/dashboard/control": "Control Page",
  "/dashboard/settings": "AI Settings",
  "/dashboard/orders": "Order Tracking",
  "/dashboard/products": "Product Entry",
  "/dashboard/ads": "Ads Library",
  "/dashboard/reseller": "Reseller",
  "/dashboard/profile": "Profile",
  "/dashboard/payment": "Payment / Topup",
  "/dashboard/admin": "Admin Control",
};

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pathParts = location.pathname.split('/');
  const platform = ['whatsapp', 'messenger', 'instagram'].includes(pathParts[2]) ? pathParts[2] : null;

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/login");
      }
      setLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!session) {
          // Clean up sensitive local storage on session end
          localStorage.removeItem("active_fb_page_id");
          localStorage.removeItem("active_fb_db_id");
          localStorage.removeItem("active_wp_db_id");
          localStorage.removeItem("active_wa_session_id");
          navigate("/login");
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  // Hidden Admin Control - Ctrl + F5
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "F5") {
        e.preventDefault();
        navigate("/dashboard/abcadmin");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Smart title lookup handling platform routes
  let currentTitle = pageTitles[location.pathname];
  if (!currentTitle && platform) {
     // Try to find generic title by removing platform from path
     // e.g. /dashboard/whatsapp/control -> /dashboard/control
     const genericPath = location.pathname.replace(`/${platform}`, '');
     currentTitle = pageTitles[genericPath];
  }
  
  if (!currentTitle) currentTitle = "Dashboard";

  const LayoutContent = (
    <div className="min-h-screen bg-background flex w-full">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <DashboardSidebar />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <DashboardSidebar />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        <DashboardHeader
          title={currentTitle}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );

  if (platform === 'whatsapp') {
    return (
      <WhatsAppProvider>
        {LayoutContent}
      </WhatsAppProvider>
    );
  }

  if (platform === 'messenger') {
    return (
      <MessengerProvider>
        {LayoutContent}
      </MessengerProvider>
    );
  }

  return LayoutContent;
}

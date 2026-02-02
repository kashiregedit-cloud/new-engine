import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Plug,
  Database,
  Settings,
  Package,
  Megaphone,
  Users,
  User,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sparkles,
  ArrowLeft,
  ShoppingBag,
  MessageSquare,
  Key
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { SessionSelector } from "./SessionSelector";
import { PageSelector } from "./PageSelector";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function DashboardSidebar({ isMobile, onLinkClick }: { isMobile?: boolean; onLinkClick?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Force expanded state on mobile
  const isCollapsed = isMobile ? false : collapsed;

  const pathParts = location.pathname.split('/');
  const platform = ['whatsapp', 'messenger', 'instagram'].includes(pathParts[2]) ? pathParts[2] : null;

  const getMenuItems = () => {
    // Define Global Tools
    const globalTools = [
      { title: "Product Entry", icon: Package, path: platform ? `/dashboard/${platform}/products` : "/dashboard/products" },
      { title: "Ads Library", icon: Megaphone, path: platform ? `/dashboard/${platform}/ads` : "/dashboard/ads" },
      { title: "Reseller", icon: Users, path: platform ? `/dashboard/${platform}/reseller` : "/dashboard/reseller" },
      { title: "Payment / Topup", icon: CreditCard, path: platform ? `/dashboard/${platform}/payment` : "/dashboard/payment" },
      // { title: "API Keys", icon: Key, path: "/dashboard/api-management" },
    ];

    if (!platform) {
      return {
        switchItem: null,
        sections: [
          { title: null, items: [{ title: "Select Platform", icon: LayoutDashboard, path: "/dashboard" }] },
          { title: "Global Tools", items: globalTools },
          { title: null, items: [{ title: "Profile", icon: User, path: "/dashboard/profile" }] }
        ]
      };
    }

    const base = `/dashboard/${platform}`;
    
    // Platform Specific Items
    const platformItems = [
      { title: "Dashboard", icon: LayoutDashboard, path: base },
      { title: platform === 'whatsapp' ? "Sessions" : "Integration", icon: Plug, path: platform === 'whatsapp' ? `${base}/sessions` : `${base}/integration` },
      { title: "Database Connect", icon: Database, path: `${base}/database` },
      { title: "Control Page", icon: Settings, path: `${base}/control` },
    ];

    if (['whatsapp', 'messenger'].includes(platform)) {
      platformItems.push({ title: "AI Settings", icon: Sparkles, path: `${base}/settings` });
      platformItems.push({ title: "Order Tracking", icon: ShoppingBag, path: `${base}/orders` });
      if (platform === 'messenger') {
        platformItems.push({ title: "Conversion", icon: MessageSquare, path: `${base}/conversion` });
      }
    }

    const switchItem = { title: "Switch Platform", icon: ArrowLeft, path: "/dashboard" };

    return {
      switchItem,
      sections: [
        { title: "Platform Menu", items: platformItems },
        { title: "Global Tools", items: globalTools },
        { title: null, items: [{ title: "Profile", icon: User, path: `${base}/profile` }] }
      ]
    };
  };

  const menu = getMenuItems();

  const handleLogout = async () => {
    // Clear all local storage keys to prevent session leakage
    localStorage.removeItem("active_fb_page_id");
    localStorage.removeItem("active_fb_db_id");
    localStorage.removeItem("active_wp_db_id");
    localStorage.removeItem("active_wa_session_id");
    localStorage.removeItem("supabase.auth.token"); // Just in case, though signOut handles it

    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  return (
    <aside
      className={cn(
        "h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 sticky top-0",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex flex-col gap-1">
            <Link to="/" className="flex items-center gap-2" onClick={onLinkClick}>
              <img src={logo} alt="Service Hub BD" className="h-8 w-auto" />
            </Link>
            {platform && (
               <span className="text-xs font-semibold uppercase text-muted-foreground ml-1">
                 {platform}
               </span>
            )}
          </div>
        )}
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="text-sidebar-foreground hover:bg-sidebar-accent"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {platform && !isCollapsed && (
          <div className="mb-4 relative z-10">
             {platform === 'whatsapp' && (
                <>
                  <WorkspaceSwitcher platform="whatsapp" />
                  <SessionSelector />
                </>
             )}
             {platform === 'messenger' && (
                <>
                  <WorkspaceSwitcher platform="messenger" />
                  <PageSelector />
                </>
             )}
          </div>
        )}

        <ul className="space-y-1">
          {/* Switch Platform (Highlighted) */}
          {menu.switchItem && (
            <li key={menu.switchItem.path} className="mb-2">
              {isCollapsed ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link
                      to={menu.switchItem.path}
                      onClick={onLinkClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-sidebar-border/50 bg-sidebar-accent/10",
                        isCollapsed && "justify-center px-2"
                      )}
                    >
                      <menu.switchItem.icon size={20} className="shrink-0 text-primary" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {menu.switchItem.title}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  to={menu.switchItem.path}
                  onClick={onLinkClick}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-sidebar-border/50 bg-sidebar-accent/10"
                  )}
                >
                  <menu.switchItem.icon size={20} className="shrink-0 text-primary" />
                  <span className="text-sm font-medium">{menu.switchItem.title}</span>
                </Link>
              )}
            </li>
          )}

          {/* Sections */}
          {menu.sections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {section.title && (
                 <div className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
                   {!isCollapsed && section.title}
                 </div>
              )}
              
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                
                if (isCollapsed) {
                  return (
                    <li key={item.path} className="mb-1">
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.path}
                            onClick={onLinkClick}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 justify-center px-2",
                              isActive
                                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            <item.icon size={20} className="shrink-0" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }

                return (
                  <li key={item.path} className="mb-1">
                    <Link
                      to={item.path}
                      onClick={onLinkClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon size={20} className="shrink-0" />
                      <span className="text-sm font-medium">{item.title}</span>
                    </Link>
                  </li>
                );
              })}
              
              {/* Separator between sections */}
              {sectionIndex < menu.sections.length - 1 && (
                 <div className="my-2 border-t border-sidebar-border/50 mx-2" />
              )}
            </div>
          ))}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-sidebar-border">
        {isCollapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground justify-center"
              >
                <LogOut size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Logout</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="w-full text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground justify-start gap-3"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </Button>
        )}
      </div>
    </aside>
  );
}

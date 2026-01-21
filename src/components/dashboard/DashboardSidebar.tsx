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
  ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { SessionSelector } from "./SessionSelector";

export function DashboardSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pathParts = location.pathname.split('/');
  const platform = ['whatsapp', 'messenger', 'instagram'].includes(pathParts[2]) ? pathParts[2] : null;

  const getMenuItems = () => {
    if (!platform) {
      return {
        switchItem: null,
        platformItems: [
          { title: "Select Platform", icon: LayoutDashboard, path: "/dashboard" },
          { title: "Profile", icon: User, path: "/dashboard/profile" },
        ],
        fixedItems: []
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

    if (platform === 'whatsapp') {
      platformItems.push({ title: "AI Settings", icon: Sparkles, path: `${base}/settings` });
    }

    // Fixed / Common Sections (Always visible)
    const fixedItems = [
      { title: "Product Entry", icon: Package, path: `${base}/products` },
      { title: "Ads Library", icon: Megaphone, path: `${base}/ads` },
      { title: "Reseller", icon: Users, path: `${base}/reseller` },
      { title: "Payment / Topup", icon: CreditCard, path: `${base}/payment` },
      { title: "Admin Panel", icon: Users, path: `${base}/admin` },
      { title: "Profile", icon: User, path: `${base}/profile` },
    ];

    const switchItem = { title: "Switch Platform", icon: ArrowLeft, path: "/dashboard" };

    return { switchItem, platformItems, fixedItems };
  };

  const menu = getMenuItems();

  const handleLogout = async () => {
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
        {!collapsed && (
          <div className="flex flex-col gap-1">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="Service Hub BD" className="h-8 w-auto" />
            </Link>
            {platform && (
               <span className="text-xs font-semibold uppercase text-muted-foreground ml-1">
                 {platform}
               </span>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {platform && !collapsed && (
          <div className="mb-4">
             {platform === 'whatsapp' && <SessionSelector />}
          </div>
        )}

        <ul className="space-y-1">
          {/* Switch Platform (Highlighted) */}
          {menu.switchItem && (
            <li key={menu.switchItem.path} className="mb-2">
              <Link
                to={menu.switchItem.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-sidebar-border/50 bg-sidebar-accent/10"
                )}
              >
                <menu.switchItem.icon size={20} className="shrink-0 text-primary" />
                {!collapsed && (
                  <span className="text-sm font-medium">{menu.switchItem.title}</span>
                )}
              </Link>
            </li>
          )}

          {/* Platform Specific Items */}
          {menu.platformItems && menu.platformItems.length > 0 && (
             <div className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
               {!collapsed && "Platform Menu"}
             </div>
          )}
          
          {menu.platformItems && menu.platformItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon size={20} className="shrink-0" />
                  {!collapsed && (
                    <span className="text-sm font-medium">{item.title}</span>
                  )}
                </Link>
              </li>
            );
          })}

          {menu.fixedItems && menu.fixedItems.length > 0 && (
            <>
               <div className="my-2 border-t border-sidebar-border/50 mx-2" />
               <div className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2">
                 {!collapsed && "Global Tools"}
               </div>
               {menu.fixedItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon size={20} className="shrink-0" />
                      {!collapsed && (
                        <span className="text-sm font-medium">{item.title}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          onClick={handleLogout}
          className={cn(
            "w-full text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground",
            collapsed ? "justify-center" : "justify-start gap-3"
          )}
        >
          <LogOut size={20} />
          {!collapsed && <span>Logout</span>}
        </Button>
      </div>
    </aside>
  );
}

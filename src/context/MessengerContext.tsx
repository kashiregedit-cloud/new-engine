import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface MessengerPage {
  page_id: string;
  name: string;
  page_access_token?: string;
  db_id?: number;
  email?: string;
  created_at?: string;
}

export interface MessengerContextType {
  pages: MessengerPage[];
  currentPage: MessengerPage | null;
  setCurrentPage: (page: MessengerPage | null) => void;
  refreshPages: () => Promise<void>;
  loading: boolean;
}

const MessengerContext = createContext<MessengerContextType | undefined>(undefined);

export function MessengerProvider({ children }: { children: React.ReactNode }) {
  const [pages, setPages] = useState<MessengerPage[]>([]);
  const [currentPage, setCurrentPage] = useState<MessengerPage | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshPages = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setPages([]);
        return;
      }

      let targetEmail = user.email;
      
      // Check Team Membership
      const { data: teamData } = await (supabase
          .from('team_members') as any)
          .select('owner_email')
          .eq('member_email', user.email)
          .single();
      
      if (teamData) {
          targetEmail = teamData.owner_email;
      }

      // 1. Fetch Pages
      // Explicitly typing the response to avoid 'never' issues
      const { data: pagesData, error: pagesError } = await supabase
        .from('page_access_token_message')
        .select('*')
        .eq('email', targetEmail);

      if (pagesError) throw pagesError;
      
      if (!pagesData || pagesData.length === 0) {
        setPages([]);
        setCurrentPage(null);
        return;
      }

      // 2. Fetch DB IDs for these pages
      const pageIds = pagesData.map((p: any) => p.page_id);
      const { data: dbData, error: dbError } = await supabase
        .from('fb_message_database')
        .select('id, page_id')
        .in('page_id', pageIds);

      if (dbError) throw dbError;

      // 3. Merge Data
      const mergedPages: MessengerPage[] = pagesData.map((p: any) => {
        const dbEntry = (dbData as any[])?.find((d: any) => d.page_id === p.page_id);
        return {
          ...p,
          db_id: dbEntry?.id
        };
      });

      setPages(mergedPages);
      
      // Auto-select logic
      const storedPageId = localStorage.getItem("active_fb_page_id");
      if (storedPageId) {
          const found = mergedPages.find(p => p.page_id === storedPageId);
          if (found) {
              setCurrentPage(found);
              // Ensure DB ID is up to date in storage
              if (found.db_id) {
                localStorage.setItem("active_fb_db_id", found.db_id.toString());
              }
          } else if (mergedPages.length > 0) {
              // If stored one is invalid/gone, select first
              updateActivePage(mergedPages[0]);
          }
      } else if (mergedPages.length > 0) {
          updateActivePage(mergedPages[0]);
      }

    } catch (error) {
      console.error("Failed to fetch messenger pages", error);
      toast.error("Failed to load Facebook pages");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateActivePage = (page: MessengerPage | null) => {
    setCurrentPage(page);
    if (page) {
      localStorage.setItem("active_fb_page_id", page.page_id);
      if (page.db_id) {
        localStorage.setItem("active_fb_db_id", page.db_id.toString());
      } else {
        localStorage.removeItem("active_fb_db_id");
      }
    } else {
      localStorage.removeItem("active_fb_page_id");
      localStorage.removeItem("active_fb_db_id");
    }
    // Dispatch events for other components
    window.dispatchEvent(new Event("storage")); 
    window.dispatchEvent(new Event("db-connection-changed"));
  };

  useEffect(() => {
    refreshPages();
  }, [refreshPages]);

  return (
    <MessengerContext.Provider value={{ 
        pages, 
        currentPage, 
        setCurrentPage: updateActivePage, 
        refreshPages, 
        loading 
    }}>
      {children}
    </MessengerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMessenger() {
  const context = useContext(MessengerContext);
  if (context === undefined) {
    throw new Error("useMessenger must be used within a MessengerProvider");
  }
  return context;
}

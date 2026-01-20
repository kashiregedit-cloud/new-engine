import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BACKEND_URL } from "@/config";

interface WhatsAppContextType {
  sessions: any[];
  currentSession: any | null;
  setCurrentSession: (session: any | null) => void;
  refreshSessions: () => Promise<void>;
  loading: boolean;
}

const WhatsAppContext = createContext<WhatsAppContextType | undefined>(undefined);

export function WhatsAppProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSessions = async () => {
    setLoading(true);
    try {
      // 1. Fetch from WAHA via Backend
      const res = await fetch(`${BACKEND_URL}/sessions`);
      const wahaSessions = await res.json();
      
      // 2. Fetch from Supabase (to sync metadata if needed)
      const { data: dbSessions } = await supabase.from('whatsapp_sessions').select('*');
      
      // Merge logic could go here, for now we trust WAHA + DB status
      // We will use WAHA sessions as the source of truth for existence
      const formattedSessions = Array.isArray(wahaSessions) ? wahaSessions : [];
      
      setSessions(formattedSessions);
      
      // Auto-select first if none selected
      if (!currentSession && formattedSessions.length > 0) {
        setCurrentSession(formattedSessions[0]);
      } else if (currentSession) {
         // Update current session object with latest data
         const updated = formattedSessions.find((s: any) => s.name === currentSession.name);
         if (updated) setCurrentSession(updated);
      }
    } catch (error) {
      console.error("Failed to fetch sessions", error);
      toast.error("Failed to load WhatsApp sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  return (
    <WhatsAppContext.Provider value={{ sessions, currentSession, setCurrentSession, refreshSessions, loading }}>
      {children}
    </WhatsAppContext.Provider>
  );
}

export function useWhatsApp() {
  const context = useContext(WhatsAppContext);
  if (context === undefined) {
    throw new Error("useWhatsApp must be used within a WhatsAppProvider");
  }
  return context;
}

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
      // 1. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // 2. Fetch all from WAHA via Backend
      const res = await fetch(`${BACKEND_URL}/sessions`);
      const wahaSessions = await res.json();
      const allSessions = Array.isArray(wahaSessions) ? wahaSessions : [];

      let formattedSessions = [];

      if (user && user.email) {
        // 3. Filter by user email from Supabase
        const { data: mySessions } = await supabase
          .from('whatsapp_sessions')
          .select('session_name')
          .eq('user_email', user.email);
          
        const allowedNames = mySessions?.map(s => s.session_name) || [];
        
        // Filter WAHA sessions to only show those owned by user
        formattedSessions = allSessions.filter((s: any) => allowedNames.includes(s.name));
      } else {
        // If no user logged in, show nothing or handle accordingly
        formattedSessions = []; 
      }
      
      setSessions(formattedSessions);
      
      // Auto-select first if none selected
      if (!currentSession && formattedSessions.length > 0) {
        setCurrentSession(formattedSessions[0]);
      } else if (currentSession) {
         // Update current session object with latest data
         const updated = formattedSessions.find((s: any) => s.name === currentSession.name);
         if (updated) setCurrentSession(updated);
         else setCurrentSession(null);
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

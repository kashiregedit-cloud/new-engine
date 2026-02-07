import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BACKEND_URL } from "@/config";

export interface WahaSession {
  name: string;
  status?: string;
  [key: string]: unknown;
}

export interface WhatsAppContextType {
  sessions: WahaSession[];
  currentSession: WahaSession | null;
  setCurrentSession: (session: WahaSession | null) => void;
  refreshSessions: () => Promise<void>;
  loading: boolean;
  // Team Features
  isTeamMember: boolean;
  teamOwnerEmail: string | null;
  viewMode: 'personal' | 'team';
  switchViewMode: (mode: 'personal' | 'team') => void;
}

const WhatsAppContext = createContext<WhatsAppContextType | undefined>(undefined);

export function WhatsAppProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<WahaSession[]>([]);
  const [currentSession, setCurrentSession] = useState<WahaSession | null>(null);
  const [loading, setLoading] = useState(true);
  const currentSessionRef = React.useRef(currentSession);
  
  // Team State
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [teamOwnerEmail, setTeamOwnerEmail] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'personal' | 'team'>(() => {
    return (localStorage.getItem('whatsapp_view_mode') as 'personal' | 'team') || 'personal';
  });

  const switchViewMode = (mode: 'personal' | 'team') => {
    setViewMode(mode);
    localStorage.setItem('whatsapp_view_mode', mode);
  };

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const refreshSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
          setSessions([]);
          return;
      }

      // Check Team Membership
      const { data: teamData } = await (supabase
          .from('team_members') as any)
          .select('id, owner_email, permissions')
          .eq('member_email', user.email)
          .maybeSingle();
      
      const isMember = !!teamData;
      const ownerEmail = teamData?.owner_email || null;

      setIsTeamMember(isMember);
      setTeamOwnerEmail(ownerEmail);

      // Determine target email
      let targetEmail = user.email;
      let isViewingOwner = false;
      if (viewMode === 'team' && isMember && ownerEmail) {
          targetEmail = ownerEmail;
          if (ownerEmail !== user.email) isViewingOwner = true;
      } else if (viewMode === 'team' && !isMember) {
          targetEmail = user.email;
      }

      // 2. Fetch Sessions (Hybrid / Direct Supabase)
      // We prioritize Direct Supabase to avoid backend sync issues, but might lose real-time status (unless we merge)
      
      let allSessions: WahaSession[] = [];

      // Fetch from DB
      const { data: dbSessions, error: dbError } = await supabase
         .from('whatsapp_message_database')
         .select('*')
         .eq('email', targetEmail); // Assuming 'email' column is used for ownership/sharing context

      if (dbError) throw dbError;

      if (dbSessions) {
          // Map DB sessions to WahaSession format
          allSessions = dbSessions.map((s: any) => ({
              name: s.session_name,
              status: s.status || 'STOPPED', // Fallback to DB status
              config: {}, // Config not available in DB usually, unless stored
              me: null,
              wp_db_id: s.id,
              wp_id: s.id,
              expires_at: s.expires_at,
              plan_days: s.plan_days,
              subscription_status: s.subscription_status || 'unknown',
              db_status: s.status || 'unknown',
              is_shared: s.email !== user.email // Check if shared
          }));
      }

      // Filter by Team Permissions (Frontend Enforcement)
      if (viewMode === 'team' && isMember && teamData?.permissions?.wa_sessions) {
          const allowedSessions = teamData.permissions.wa_sessions;
          if (Array.isArray(allowedSessions)) {
              allSessions = allSessions.filter(s => allowedSessions.includes(s.name));
          }
      }

      // Filter based on View Mode
      let formattedSessions: WahaSession[] = [];
      if (viewMode === 'team') {
          // In team mode, show sessions owned by team owner (targetEmail)
          // We already filtered by targetEmail above.
          // Just ensure we don't show sessions that shouldn't be visible (redundant check but safe)
           formattedSessions = allSessions;
      } else {
          // Personal mode
          formattedSessions = allSessions;
      }
      
      setSessions(formattedSessions);
      
      // Auto-select first if none selected
      const current = currentSessionRef.current;
      if (!current && formattedSessions.length > 0) {
        setCurrentSession(formattedSessions[0]);
      } else if (current) {
        // Update current session object with latest data
        const updated = formattedSessions.find((s) => s.name === current.name);
        if (updated) setCurrentSession(updated);
        else setCurrentSession(null);
      }
    } catch (error) {
      console.error("Failed to fetch sessions", error);
      toast.error("Failed to load WhatsApp sessions");
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <WhatsAppContext.Provider value={{ 
        sessions, 
        currentSession, 
        setCurrentSession, 
        refreshSessions, 
        loading,
        isTeamMember,
        teamOwnerEmail,
        viewMode,
        switchViewMode
    }}>
      {children}
    </WhatsAppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWhatsApp() {
  const context = useContext(WhatsAppContext);
  if (context === undefined) {
    throw new Error("useWhatsApp must be used within a WhatsAppProvider");
  }
  return context;
}

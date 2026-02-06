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
          .select('owner_email, permissions')
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

      // 2. Fetch all from WAHA via Backend
      const res = await fetch(`${BACKEND_URL}/whatsapp/sessions`);
      const wahaSessions = await res.json();
      const allSessions: WahaSession[] = Array.isArray(wahaSessions) ? wahaSessions : [];

      let formattedSessions: WahaSession[] = [];

      // 3. Filter by target email from Supabase
      // Note: We switched to whatsapp_message_database which uses user_id
      // For shared sessions (Team Mode), we use 'email' column.
      // For own sessions, we use 'user_id' (to support old sessions without email).
      
      let query = supabase
          .from('whatsapp_message_database')
          .select('id, session_name, expires_at');
        
      if (isViewingOwner) {
          // Viewing someone else's sessions -> Must match email
          query = query.eq('email', targetEmail);
      } else {
          // Viewing my own sessions -> Match user_id
          query = query.eq('user_id', user.id);
      }

      const { data: mySessions } = await query.returns<{ id: number; session_name: string; expires_at: string | null }[]>();
        
      const dbSessionMap = new Map(mySessions?.map(s => [s.session_name, s]) || []);
      let allowedNames = Array.from(dbSessionMap.keys());
      
      // Filter by Team Permissions
      if (viewMode === 'team' && isMember && teamData?.permissions?.wa_sessions) {
          const allowedPermissions = teamData.permissions.wa_sessions;
          if (Array.isArray(allowedPermissions)) {
             allowedNames = allowedNames.filter(name => allowedPermissions.includes(name));
          }
      }
      
      // Filter WAHA sessions to only show allowed ones and merge DB data
      formattedSessions = allSessions
          .filter((s) => allowedNames.includes(s.name))
          .map(s => {
              // Try exact match first, then case-insensitive
              let dbSession = dbSessionMap.get(s.name);
              if (!dbSession) {
                  // Fallback: Case-insensitive search
                  const key = Array.from(dbSessionMap.keys()).find(k => k.toLowerCase() === s.name.toLowerCase());
                  if (key) dbSession = dbSessionMap.get(key);
              }

              return {
                ...s,
                wp_db_id: dbSession?.id,
                expires_at: dbSession?.expires_at
              };
          });
      
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

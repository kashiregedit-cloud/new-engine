import { useWhatsApp } from "@/context/WhatsAppContext";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, PlusCircle, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function SessionSelector() {
  const context = useWhatsApp();
  const navigate = useNavigate();
  const { sessions, currentSession, setCurrentSession } = context;

  const handleValueChange = (value: string) => {
    if (value === "add_new") {
      navigate("/dashboard/whatsapp/sessions");
      return;
    }
    const selected = sessions.find((s) => s.name === value);
    if (selected) {
      setCurrentSession(selected);
      
      // Auto-connect DB logic
      const dbId = (selected as any).wp_db_id;
      if (dbId) {
          const dbIdStr = String(dbId);
          if (localStorage.getItem("active_wp_db_id") !== dbIdStr) {
              localStorage.setItem("active_wp_db_id", dbIdStr);
              // Also set session ID (name) for other components
              localStorage.setItem("active_wa_session_id", selected.name);
              window.dispatchEvent(new Event("db-connection-changed"));
          }
      } else {
         // Even if no DB ID (rare), set session ID
         localStorage.setItem("active_wa_session_id", selected.name);
         window.dispatchEvent(new Event("db-connection-changed"));
      }
    }
  };

  // Auto-sync DB ID when currentSession changes (e.g. after creation or refresh)
  useEffect(() => {
    if (currentSession) {
      localStorage.setItem("active_wa_session_id", currentSession.name);
      
      const dbId = (currentSession as any).wp_db_id;
      if (dbId) {
        const dbIdStr = String(dbId);
        const currentStored = localStorage.getItem("active_wp_db_id");
        if (currentStored !== dbIdStr) {
          localStorage.setItem("active_wp_db_id", dbIdStr);
          window.dispatchEvent(new Event("db-connection-changed"));
          // console.log("Auto-connected DB:", dbIdStr);
        }
      }
    }
  }, [currentSession]);

  // Sync LocalStorage when currentSession changes (e.g. auto-selected on load)
  useEffect(() => {
    if (currentSession) {
        localStorage.setItem("active_wa_session_id", currentSession.name);
        
        if ((currentSession as any).wp_db_id) {
            const dbId = String((currentSession as any).wp_db_id);
            if (localStorage.getItem("active_wp_db_id") !== dbId) {
                localStorage.setItem("active_wp_db_id", dbId);
                window.dispatchEvent(new Event("db-connection-changed"));
            }
        }
    }
  }, [currentSession]);

  if (sessions.length === 0) {
    return (
       <div 
         className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
         onClick={() => navigate("/dashboard/whatsapp/sessions")}
       >
         <PlusCircle size={16} />
         <span>Create Session</span>
       </div>
    );
  }

  return (
    <div className="px-2 mb-4">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block px-1">
        Active Session
      </label>
      <Select
        value={currentSession?.name || ""}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className="w-full bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-9">
          <div className="flex items-center gap-2 overflow-hidden">
            <MessageSquare size={14} className="shrink-0" />
            <SelectValue placeholder="Select Session" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {sessions.map((session) => (
            <SelectItem key={session.name} value={session.name}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${session.status === 'WORKING' ? 'bg-green-500' : 'bg-red-500'}`} />
                {session.name}
              </div>
            </SelectItem>
          ))}
          <div className="h-px bg-border my-1" />
          <SelectItem value="add_new" className="text-primary focus:text-primary cursor-pointer">
            <div className="flex items-center gap-2">
              <PlusCircle size={14} />
              Manage Sessions
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

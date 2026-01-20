import { useWhatsApp } from "@/context/WhatsAppContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function SessionSelector() {
  const { sessions, currentSession, setCurrentSession } = useWhatsApp();
  const navigate = useNavigate();

  const handleValueChange = (value: string) => {
    if (value === "add_new") {
      navigate("/dashboard/whatsapp/sessions"); // Navigate to session manager
      return;
    }
    const selected = sessions.find((s) => s.name === value);
    if (selected) {
      setCurrentSession(selected);
    }
  };

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

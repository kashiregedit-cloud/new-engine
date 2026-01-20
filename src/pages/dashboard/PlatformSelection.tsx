import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Facebook, Instagram } from "lucide-react";

export default function PlatformSelection() {
  const navigate = useNavigate();

  const platforms = [
    {
      id: "whatsapp",
      name: "WhatsApp",
      description: "Manage your WhatsApp Business automation",
      icon: MessageSquare,
      color: "bg-green-500",
    },
    {
      id: "messenger",
      name: "Messenger",
      description: "Manage your Facebook Messenger automation",
      icon: Facebook,
      color: "bg-blue-500",
    },
    {
      id: "instagram",
      name: "Instagram",
      description: "Manage your Instagram DM automation",
      icon: Instagram,
      color: "bg-pink-500",
    },
  ];

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-6 text-center">Select Platform</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {platforms.map((platform) => (
          <Card 
            key={platform.id} 
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => navigate(`/dashboard/${platform}`)}
          >
            <CardHeader className="flex flex-row items-center gap-4">
              <div className={`p-3 rounded-full text-white ${platform.color}`}>
                <platform.icon size={24} />
              </div>
              <div>
                <CardTitle>{platform.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>{platform.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

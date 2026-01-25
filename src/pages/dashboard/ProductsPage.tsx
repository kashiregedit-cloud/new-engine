import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock } from "lucide-react";

export default function ProductsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <div className="p-4 rounded-full bg-muted">
        <Lock className="w-12 h-12 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Product Entry</h1>
        <p className="text-muted-foreground max-w-sm mx-auto">
          This feature is currently locked and will be available in a future update.
        </p>
      </div>
      <Card className="w-full max-w-md mt-8">
        <CardHeader>
          <CardTitle className="text-center text-primary">Coming Soon</CardTitle>
          <CardDescription className="text-center">
            We are working hard to bring you advanced product management features.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

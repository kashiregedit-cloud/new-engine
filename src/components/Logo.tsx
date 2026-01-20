import { cn } from "@/lib/utils";
import logoImage from "@/assets/logo.png";

interface LogoProps {
  className?: string;
  showText?: boolean;
  animated?: boolean;
  size?: "sm" | "md" | "lg";
}

const Logo = ({ className, showText = true, animated = true, size = "md" }: LogoProps) => {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-14 w-14"
  };

  const textSizeClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl"
  };

  const subtextSizeClasses = {
    sm: "text-[8px]",
    md: "text-[10px]",
    lg: "text-xs"
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn(
        "relative flex items-center justify-center rounded-xl",
        sizeClasses[size],
        animated && "animate-pulse-glow"
      )}>
        <img 
          src={logoImage} 
          alt="SalesmanAI Logo" 
          className={cn("object-contain", sizeClasses[size])}
        />
        {animated && (
          <div className="absolute inset-0 rounded-xl bg-primary/20 blur-md animate-glow" />
        )}
      </div>
      {showText && (
        <div className="flex flex-col">
          <span className={cn("font-bold tracking-tight text-foreground", textSizeClasses[size])}>
            SALESMAN<span className="text-primary">AI</span>
          </span>
          <span className={cn("uppercase tracking-[0.2em] text-muted-foreground", subtextSizeClasses[size])}>
            Chatbot Solution
          </span>
        </div>
      )}
    </div>
  );
};

export default Logo;

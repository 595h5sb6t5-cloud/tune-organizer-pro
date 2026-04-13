import { ReactNode, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HorizontalRowProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
  className?: string;
}

export function HorizontalRow({ title, icon, count, children, className }: HorizontalRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <h2 className="font-heading text-xl">{title}</h2>
        {count != null && <span className="text-sm text-muted-foreground">({count})</span>}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => scroll("left")}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => scroll("right")}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

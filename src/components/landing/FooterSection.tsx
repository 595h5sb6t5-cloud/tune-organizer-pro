import { Music2 } from "lucide-react";

const FooterSection = () => {
  return (
    <footer className="py-12 border-t border-border">
      <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Music2 className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-heading text-lg">Tempo</span>
        </div>
        <p className="text-sm text-muted-foreground">
          © 2026 Tempo. Your music, beautifully organized.
        </p>
      </div>
    </footer>
  );
};

export default FooterSection;

import { Github } from 'lucide-react';
import { env } from '@/env';

export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-6">
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row md:h-14">
        <p className="text-sm text-muted-foreground">
          Created by <span className="font-semibold text-foreground">migokartel</span>
        </p>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/0xzapata/midnight-invoice"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="w-5 h-5" />
            <span className="sr-only">GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  );
};

import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-10 h-10',
  lg: 'w-16 h-16',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Zap 
        className={cn(
          'animate-pulse-lightning',
          sizeClasses[size]
        )}
        fill="currentColor"
      />
    </div>
  );
}

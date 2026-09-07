'use client';

import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';

// Click/tap (not hover-only), with the existing primitive handling keyboard,
// Escape, outside press, collision avoidance and return focus to the trigger.
export function DetailHelp({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className="detail-help-trigger"
        aria-label={`${title}说明`}
      >
        <CircleHelp size={17} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="detail-help-content"
        align="start"
        sideOffset={8}
      >
        <PopoverTitle>{title}说明</PopoverTitle>
        <PopoverDescription className="detail-help-copy">
          {children}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

'use client';

import type { ReactNode } from 'react';

interface TonosTilePreviewProps {
  children: ReactNode;
  filter: string;
  className?: string;
}

/**
 * Wraps a photo tile with a CSS filter for a Tonos column (warm/none/cool).
 * The filter string comes from getTonosColumnCSSFilter().
 */
export function TonosTilePreview({ children, filter, className }: TonosTilePreviewProps) {
  return (
    <div
      className={['h-full w-full overflow-hidden', className].filter(Boolean).join(' ')}
      style={{ filter, aspectRatio: '1' }}
    >
      {children}
    </div>
  );
}

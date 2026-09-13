import React from 'react';
import type { CanonStatus } from '../../lib/types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: CanonStatus | 'neutral' | 'accent' | 'danger' | 'success';
  className?: string;
  size?: 'sm' | 'md';
}

export function Badge({ children, variant = 'neutral', className = '', size = 'md' }: BadgeProps) {
  let variantClass = 'badge-neutral';
  if (variant === 'canon') variantClass = 'badge-canon';
  else if (variant === 'pending') variantClass = 'badge-pending';
  else if (variant === 'draft') variantClass = 'badge-draft';
  else if (variant === 'retconned' || variant === 'danger') variantClass = 'badge-retconned';
  else if (variant === 'archived') variantClass = 'badge-archived';
  else if (variant === 'success') variantClass = 'badge-canon';

  const sizeStyle = size === 'sm' ? { fontSize: '10px', padding: '0px 4px' } : {};

  return (
    <span className={`badge ${variantClass} ${className}`} style={sizeStyle}>
      {children}
    </span>
  );
}

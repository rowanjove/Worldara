import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | undefined;
  size?: 'sm' | 'md' | undefined;
  loading?: boolean | undefined;
  icon?: React.ReactNode | undefined;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const variantClass = `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : '';

  return (
    <button
      className={`btn ${variantClass} ${sizeClass} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: 'spin 0.8s linear infinite' }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>处理中…</span>
        </>
      ) : (
        <>
          {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
}

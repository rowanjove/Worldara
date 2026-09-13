import React from 'react';
import { IconAlertTriangle, IconCheck } from './Icons';

export interface ToastItem {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}
          onClick={() => onDismiss(toast.id)}
          role="alert"
        >
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {toast.type === 'error' ? <IconAlertTriangle size={14} /> : <IconCheck size={14} />}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

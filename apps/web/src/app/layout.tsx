import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Worldara 世界格 · 世界设定创作与管理',
  description: '把人物、地点、关系与历史安放进同一个世界。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

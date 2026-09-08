import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '房账 · 出租管理', description: '管理房源、租客、合同、押金与每一笔收支。', icons:{icon:'/favicon.svg'} };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }

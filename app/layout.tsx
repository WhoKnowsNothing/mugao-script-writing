import type { Metadata } from 'next';
import './globals.css';
import './editor.css';

export const metadata: Metadata = {
  title: '幕稿 · 视频脚本编辑器',
  description:
    '一个安静的写作空间：分段双栏编辑视频文案、画面、BGM 和附注，统计字数与口播时长，导出 Markdown 与 Word。',
  metadataBase: new URL(process.env.SITE_ORIGIN || 'http://localhost:3000'),
  openGraph: {
    title: '幕稿 · 视频脚本编辑器',
    description:
      '把想法，写成画面。分段双栏写作，导出 Markdown / Word。文案保存在你的浏览器。',
    locale: 'zh_CN',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1731,
        height: 909,
        alt: '幕稿 — 把想法，写成画面',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '幕稿 · 视频脚本编辑器',
    description: '把想法，写成画面。分段双栏写作，导出 Markdown / Word。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

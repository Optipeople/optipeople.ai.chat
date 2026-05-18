import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { AuthProvider } from "@/auth/AuthContext";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { FileViewerProvider } from "@/components/FileViewer";

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken-grotesk",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`h-full ${hankenGrotesk.variable}`}>
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <ConfirmProvider>
              <FileViewerProvider>{children}</FileViewerProvider>
            </ConfirmProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

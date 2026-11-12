import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/auth/AuthContext";
import { ConfirmProvider, UiLabelsProvider, type UiLabels } from "@optipeople/ui";
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
  // Shrink the layout viewport when the on-screen keyboard opens
  // (Android Chrome defaults to resizes-visual since 108), so the chat
  // composer stays above the keyboard.
  interactiveWidget: "resizes-content",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const locale = await getLocale();
  const title = t("title");
  const description = t("description");
  const siteName = t("siteName");
  const ogImage = "/optipeople-logo-icon.png";
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName,
      title,
      description,
      locale,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const [tCommon, tEditor, tMarkdown, tChat] = await Promise.all([
    getTranslations("common"),
    getTranslations("textEditor"),
    getTranslations("markdown"),
    getTranslations("chat"),
  ]);

  // Texts the @optipeople/ui components render by themselves. The labels
  // left out keep the package's English default on purpose: the texts that
  // were fixed English before the package (Spinner, Pagination, the chart
  // and KPI placeholders), and those of components this app does not use
  // (MultiSelect, searchable Select, DateField).
  const uiLabels: Partial<UiLabels> = {
    cancel: tCommon("cancel"),
    close: tCommon("close"),
    delete: tCommon("delete"),
    ok: tCommon("ok"),
    remove: tCommon("remove"),
    search: tCommon("search"),
    clearSearch: tCommon("clearSearch"),
    closeDialog: tCommon("closeDialog"),
    bold: tEditor("bold"),
    insertLink: tEditor("insertLink"),
    spellCheck: tEditor("spellCheck"),
    copy: tChat("copy"),
    copied: tChat("copied"),
    followUps: tMarkdown("followUps"),
    calloutNote: tMarkdown("callout.note"),
    calloutTip: tMarkdown("callout.tip"),
    calloutImportant: tMarkdown("callout.important"),
    calloutWarning: tMarkdown("callout.warning"),
    calloutCaution: tMarkdown("callout.caution"),
  };

  return (
    <html lang={locale} className={`h-full ${hankenGrotesk.variable}`}>
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <UiLabelsProvider locale={locale} labels={uiLabels}>
            <AuthProvider>
              <ConfirmProvider>
                <FileViewerProvider>{children}</FileViewerProvider>
              </ConfirmProvider>
            </AuthProvider>
          </UiLabelsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

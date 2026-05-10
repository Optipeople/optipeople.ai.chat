import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/auth/AuthContext";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export const metadata: Metadata = {
  title: "OptiAI",
  description:
    "AI-assistent for operatører i træindustrien — hurtige svar fra maskinens manualer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da" className="h-full">
      <body className="min-h-full">
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

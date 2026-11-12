import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // @optipeople/ui ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@optipeople/ui"],
};

export default withNextIntl(nextConfig);

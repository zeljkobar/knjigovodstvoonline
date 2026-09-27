import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the IMAP protocol parser in native Node modules, including during development.
  serverExternalPackages: ["imapflow"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AGENTS.md is maintained by hand; stop `next dev` from injecting its block.
  agentRules: false,
  serverExternalPackages: ["sharp"],
};

export default nextConfig;

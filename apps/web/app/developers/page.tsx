import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Developers' };
export const revalidate = 3600;

export default async function DevelopersPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="Developers"
      body={`The query API lives under /v1 on ${config.siteUrl}: availability, registration requests, name lookup, card versions. The MCP server exposes seven tools — check_name, prepare_registration and submit_registration for an agent with its own wallet, request_name and get_status for an agent without one, plus draft_card and get_profile — and any AI that can connect to MCP can call them directly. Record verification is offline: the CLI is in packages/verify, the browser version is at /verify, and the verdict is computed on your own machine rather than on our server.`}
    />
  );
}

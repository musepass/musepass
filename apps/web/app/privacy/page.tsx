import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Privacy' };
export const revalidate = 3600;

export default async function PrivacyPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="Privacy"
      body="The privacy policy is not written yet. What is already true of the product: every card field is private by default — only the name and the address are visible, and the owner opts the rest in one field at a time. A track record only holds what evidence can prove."
    />
  );
}

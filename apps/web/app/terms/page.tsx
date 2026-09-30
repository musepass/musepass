import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Terms' };
export const revalidate = 3600;

export default async function TermsPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="Terms"
      body="The terms of service are not written yet, and the project owner has to put them in place before launch. Until they exist, we do not claim that any user has accepted anything."
    />
  );
}

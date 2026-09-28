import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '隐私政策' };
export const revalidate = 3600;

export default async function PrivacyPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="隐私政策"
      body="隐私政策还没有定稿。可以确定的是产品本身的原则：名片字段默认全部不公开，只有名字和地址可见，其余由主人逐项选择；履历只记录能被证据证明的事。"
    />
  );
}

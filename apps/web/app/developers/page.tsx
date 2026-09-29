import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '开发者文档' };
export const revalidate = 3600;

export default async function DevelopersPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="开发者文档"
      body={`查询接口在 ${config.siteUrl} 同名后端的 /v1 下：可用性查询、注册请求、名字查询、名片版本。MCP 服务提供 check_name、request_name、get_status、draft_card、get_profile 五个工具，任何能连接 MCP 的 AI 都可以直接调用。履历验证是离线的：命令行在 packages/verify，浏览器里在 /verify —— 判定在你自己那台机器上算，不经过我们的服务器。`}
    />
  );
}

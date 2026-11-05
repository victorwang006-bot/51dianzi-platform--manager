import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { getAdminWorkspaceNavigationState as state, getAdminWorkspaceNavigationTarget as target, groupAdminBusinessNavigationItems as groups } from '../client/src/components/admin/adminWorkspaceNavigationModel';
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from '../client/src/components/admin/adminWorkbenchNavigationModel';
import { channelInventoryTabLocation } from '../client/src/lib/channelInventoryNavigation';
import { Logo } from '../client/src/components/Logo';
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(g => g.paths).map(path => ({ path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path }));
(async () => {
  const factory = (0,eval)(await (await fetch('./factory-expression.js')).text());
  const { WorkspaceTabs } = factory({ React, jsx, state, target, groups, zone: 'Asia/Shanghai' });
  (window as any).__navCalls = [];
  function Fixture() {
    const [location, setLocation] = React.useState('/workbench/channel-inventory?ciTab=materials');
    (window as any).__setNavFixtureLocation = setLocation;
    return <div className="admin-workspace-shell">
      <div className="admin-workspace-shell__navigation">
        <header className="admin-workspace-shell__header">
          <a className="admin-workspace-shell__brand" href="#" aria-label="51电子网后台首页：渠道库存">
            <Logo className="h-9 w-auto shrink-0 object-contain" />
            <div className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-base font-bold leading-none tracking-tight text-primary">51电子网</span><span className="truncate text-[11px] leading-none text-muted-foreground">后台管理系统</span></div>
          </a>
          <WorkspaceTabs items={items} location={location} renderBadge={(item: any) => item.path === '/messages' ? <span aria-label="7 条未读">7</span> : null}
            onNavigate={(item: any, tab?: string) => { (window as any).__navCalls.push({ path: item.path, tab }); setLocation(item.path === '/workbench/channel-inventory' ? channelInventoryTabLocation(tab) ?? item.path : item.path); }} />
          <button className="admin-workspace-shell__account flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5"><span className="h-8 w-8 rounded-full bg-primary text-white">管</span></button>
        </header>
      </div>
      <main className="admin-workspace-shell__main admin-unified-content" data-admin-ui-system="channel-inventory">
        <div className="ci-page ci-host">
          <p>四顶栏与二三级菜单隔离验证：使用真实增量工厂和原现网CSS，不读写生产业务。</p>
          <div style={{ height: 240, border: '1px solid #e5eaf0', borderRadius: 6, background: '#fff' }} data-nav-content="true">现有业务内容占位；仅验证菜单展开不推移正文。</div>
        </div>
      </main>
    </div>;
  }
  document.body.dataset.adminReadability = 'true';
  createRoot(document.getElementById('root')!).render(<Fixture />);
})();

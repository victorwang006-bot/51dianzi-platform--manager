import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import {
  getAdminWorkspaceNavigationState as state,
  getAdminWorkspaceNavigationTarget as target,
  groupAdminBusinessNavigationItems as groups,
  getAdminWorkspaceForLocation,
} from '../client/src/components/admin/adminWorkspaceNavigationModel';
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from '../client/src/components/admin/adminWorkbenchNavigationModel';
import { Logo } from '../client/src/components/Logo';
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(g => g.paths).map(path => ({ path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path }));
(async () => {
  const factory = (0,eval)(await (await fetch('./factory-expression.js')).text());
  const { WorkspaceTabs } = factory({ React, jsx, state, target, groups, zone: 'Asia/Shanghai' });
  (window as any).__navCalls = [];
  function Fixture() {
    const [location, setLocation] = React.useState('/workbench/channel-inventory');
    (window as any).__setNavFixtureLocation = setLocation;
    return <div className="admin-workspace-shell">
      <div className="admin-workspace-shell__navigation">
        <header className="admin-workspace-shell__header">
          <a className="admin-workspace-shell__brand" href="#" aria-label="51电子网后台首页：渠道库存">
            <Logo className="h-9 w-auto shrink-0 object-contain" />
            <div className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-base font-bold leading-none tracking-tight text-primary">51电子网</span><span className="truncate text-[11px] leading-none text-muted-foreground">后台管理系统</span></div>
          </a>
          <WorkspaceTabs items={items} location={location} onNavigate={(item: any) => { (window as any).__navCalls.push(item.path); setLocation(item.path); }} />
          <button className="admin-workspace-shell__account flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5"><span className="h-8 w-8 rounded-full bg-primary text-white">管</span></button>
        </header>
        {getAdminWorkspaceForLocation(location)?.id !== 'business' ? <div style={{ height: 42 }} data-test-secondary="true">非业务工作区原二级行位置</div> : null}
      </div>
      <main className="admin-workspace-shell__main admin-unified-content" data-admin-ui-system="channel-inventory">
        <div className="ci-page ci-host">
          <div style={{ borderBottom: '1px solid #e5eaf0', paddingBottom: 14 }}><span style={{ color: '#185FA5', marginRight: 24 }}>渠道库存</span><span>渠道档案</span></div>
          <p>导航组件隔离测量页：仅使用合成导航权限，不读取或写入线上业务数据。</p>
          <div style={{ height: 240, border: '1px solid #e5eaf0', borderRadius: 6, background: '#fff' }} data-nav-content="true">现有业务内容占位；用于验证菜单展开不推移正文。</div>
        </div>
      </main>
    </div>;
  }
  document.body.dataset.adminReadability = 'true';
  createRoot(document.getElementById('root')!).render(<Fixture />);
})();

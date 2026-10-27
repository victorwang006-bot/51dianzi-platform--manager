export async function runLayoutChecks(newCssUrl) {
  const original = await (await fetch('/assets/index-BQ9-sahB.css')).text();
  const patched = await (await fetch(newCssUrl)).text();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:300px;height:1000px;border:0';
  document.body.append(frame);
  try {
    const d = frame.contentDocument;
    d.open(); d.write('<!doctype html><html><head></head><body></body></html>'); d.close();
    const style = d.createElement('style'); style.textContent = original + '\n' + patched; d.head.append(style);
    const results = [];
    for (const zoom of [1, 1.25, 1.5]) {
    d.body.style.zoom = String(zoom);
    for (const height of [900, 700, 520, 420, 300]) {
      for (const folded of [false, true]) {
        const aside = d.createElement('aside');
        aside.className = 'group flex flex-col';
        aside.setAttribute('data-collapsible', folded ? 'icon' : '');
        aside.style.cssText = `height:${height / zoom}px;width:${folded ? 48 : 250}px;overflow:hidden`;
        aside.innerHTML = '<div data-sidebar="header" class="flex flex-col h-16 justify-center border-b">Logo</div><div data-sidebar="content" class="flex min-h-0 flex-1 flex-col gap-0 py-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden"></div><div data-sidebar="footer" class="flex flex-col p-3 border-t">账号</div>';
        d.body.append(aside);
        const box = aside.querySelector('[data-sidebar="content"]');
        for (const [title, count] of [['平台管理',6], ['系统管理',2]]) {
          const g = d.createElement('div'); g.setAttribute('data-sidebar','group');
          g.className = 'relative flex w-full min-w-0 flex-col py-1';
          g.innerHTML = `<div class="flex h-8 shrink-0 items-center group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">${title}</div><div class="w-full"><ul class="flex w-full min-w-0 flex-col gap-1">${Array.from({length:count},(_,i)=>'<li class="relative"><button class="flex h-9 w-full items-center sidebar-menu-item"><span class="group-data-[collapsible=icon]:hidden">原菜单 '+(i+1)+'</span><span class="ml-auto inline-flex h-5 min-w-5 rounded-full bg-red-500 text-white">1</span></button></li>').join('')}</ul></div>`;
          box.append(g);
        }
        const z = d.createElement('section'); z.className = 'zj-sidebar';
        z.innerHTML = '<h2>智捷业务</h2><ul>'+Array.from({length:14},(_,i)=>'<li><button><svg width="16" height="16" aria-hidden="true"></svg><span>智捷菜单 '+(i+1)+'</span></button></li>').join('')+'</ul>';
        box.append(z);
        const groups = [...box.children];
        const overlaps = groups.slice(0,-1).some((g,i)=>Math.max(...[...g.querySelectorAll('button')].map(b=>b.getBoundingClientRect().bottom)) > groups[i+1].getBoundingClientRect().top+1);
        const header = aside.querySelector('[data-sidebar="header"]'), footer = aside.querySelector('[data-sidebar="footer"]');
        const positionsBefore = [header.getBoundingClientRect().top,footer.getBoundingClientRect().top];
        box.scrollTop = box.scrollHeight;
        const last = z.querySelector('li:last-child button').getBoundingClientRect(); const br = box.getBoundingClientRect();
        let clickCount = 0; z.querySelector('li:last-child button').addEventListener('click',()=>clickCount++);z.querySelector('li:last-child button').click();
        const r = {
          height, folded, zoom, noOverlap:!overlaps,
          groupsNotCompressed:groups.every(g=>getComputedStyle(g).flexShrink==='0'),
          verticalScrollEnabled:['auto','scroll'].includes(getComputedStyle(box).overflowY),
          lastMenuReachable:last.bottom <= br.bottom+1 && last.top>=br.top-1,
          fixedLogoAndAccount:positionsBefore[0]===header.getBoundingClientRect().top && positionsBefore[1]===footer.getBoundingClientRect().top,
          labelStateCorrect: getComputedStyle(z.querySelector('button span')).display === (folded ? 'none' : 'block'),
          normalFontSize:getComputedStyle(z).fontSize==='13px',
          badgePresent:!!box.querySelector('.bg-red-500'),
          buttonEventWorks:clickCount===1,
          noHorizontalOverflow:box.scrollWidth<=box.clientWidth+1,
        };
        // A flex item's span may compute as block; verify visibility rather than exact layout type.
        r.labelStateCorrect = folded ? getComputedStyle(z.querySelector('button span')).display==='none' : getComputedStyle(z.querySelector('button span')).display!=='none';
        r.passed=Object.entries(r).every(([k,v])=>k==='folded'||typeof v!=='boolean'||v);
        results.push(r); aside.remove();
      }
    }
    }
    return {isolated:true,productionMutation:false,caseCount:results.length,allPassed:results.every(r=>r.passed),results};
  } finally {frame.remove();}
}

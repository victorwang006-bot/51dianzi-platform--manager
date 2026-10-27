import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { BriefcaseBusiness, UsersRound, FileClock } from "lucide-react";
import "./zhijie-sidebar.css";
import { ZHIJIE_MODULES, type ZhijieContext } from "@shared/zhijieBusiness";
import { preloadAdminRoute } from "@/lib/adminRouteChunks";
export default function ZhijieSidebar() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [result, setResult] = useState<{
    userId: number;
    context: ZhijieContext;
  } | null>(null);
  useEffect(() => {
    if (!user) {
      setResult(null);
      return;
    }
    const abort = new AbortController();
    const userId = user.id;
    const refresh = () => {
      void fetch("/api/zhijie/context", {
        credentials: "include",
        cache: "no-store",
        signal: abort.signal,
      })
        .then(async r => {
          if (!r.ok) throw new Error("not-authorized");
          return r.json() as Promise<ZhijieContext>;
        })
        .then(context => {
          if (!abort.signal.aborted) setResult({ userId, context });
        })
        .catch(() => {
          if (!abort.signal.aborted) setResult(null);
        });
    };
    refresh();
    window.addEventListener("zhijie-access-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      abort.abort();
      window.removeEventListener("zhijie-access-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id]);
  const context = result && result.userId === user?.id ? result.context : null;
  if (!context || (!context.authorized && !context.canConfigure)) return null;
  const items: Array<{
    label: string;
    path: string;
    icon: typeof BriefcaseBusiness;
  }> = ZHIJIE_MODULES.filter(
    m => context.canConfigure || context.readableModules.includes(m.id)
  ).map(m => ({
    label: m.label,
    path: `/zhijie/${m.id}`,
    icon: BriefcaseBusiness,
  }));
  if (context.authorized || context.canConfigure)
    items.push({
      label: "团队与岗位权限",
      path: "/zhijie/team-access",
      icon: UsersRound,
    });
  if (context.canConfigure)
    items.push({
      label: "授权操作记录",
      path: "/zhijie/audit",
      icon: FileClock,
    });
  return (
    <section className="zj-sidebar" aria-label="智捷业务">
      <h2>智捷业务</h2>
      <ul>
        {items.map(item => (
          <li key={item.path}>
            <button
              type="button"
              aria-current={location === item.path ? "page" : undefined}
              title={item.label}
              onClick={() => setLocation(item.path)}
              onMouseEnter={() => preloadAdminRoute("zhijie")}
              onFocus={() => preloadAdminRoute("zhijie")}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

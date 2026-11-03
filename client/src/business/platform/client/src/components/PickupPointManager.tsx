import { useState } from "react";
import { ChevronDown, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import { classifyBusinessFailure } from "../../../../BusinessWorkbenchSession";

const emptyForm = {
  id: undefined as number | undefined,
  name: "",
  address: "",
  contactName: "",
  contactPhone: "",
  businessHours: "",
  enabled: true,
  sortOrder: 0,
};

type FormState = typeof emptyForm;

export default function PickupPointManager({
  approved,
}: {
  approved: boolean;
}) {
  const utils = trpc.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const pointsQuery = trpc.pickupPoint.mine.useQuery(undefined, {
    enabled: approved && isOpen, retry: false,
  });
  const { isLoading } = pointsQuery;
  const points = approved && !pointsQuery.isError ? pointsQuery.data ?? [] : [];
  const [editing, setEditing] = useState<FormState | null>(null);
  const save = trpc.pickupPoint.save.useMutation({
    onSuccess: () => {
      toast.success("已保存");
      setEditing(null);
      utils.pickupPoint.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.pickupPoint.remove.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      utils.pickupPoint.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const startEdit = (point: (typeof points)[number]) => {
    setEditing({
      id: point.id,
      name: point.name,
      address: point.address,
      contactName: point.contactName,
      contactPhone: point.contactPhone,
      businessHours: point.businessHours || "",
      enabled: point.enabled,
      sortOrder: point.sortOrder,
    });
  };

  const submit = () => {
    if (!editing) return;
    save.mutate({
      ...editing,
      name: editing.name.trim(),
      address: editing.address.trim(),
      contactName: editing.contactName.trim(),
      contactPhone: editing.contactPhone.trim(),
      businessHours: editing.businessHours.trim() || undefined,
    });
  };

  return (
    <section className="mt-4 overflow-hidden rounded-lg border bg-white">
      <button
        type="button"
        data-testid="pickup-point-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(value => !value)}
        className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-slate-50 ${isOpen ? "border-b" : ""}`}
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[#233548]">自提点</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">买家可在结算时选择</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>共 {points.length} 个</span>
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen ? <div className="p-5">
        <div className="flex justify-end">
        <button
          type="button"
          disabled={!approved || editing !== null || pointsQuery.isError || !pointsQuery.isSuccess}
          className="crm-btn crm-btn-primary h-9 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setEditing({ ...emptyForm })}
        >
          <Plus size={16} /> 新增
        </button>
        </div>

      {!approved && (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          企业审核通过后可设置。
        </div>
      )}

      {!approved ? null : pointsQuery.isError ? (
        <div className="mt-4 text-sm text-red-700" role="status">
          <p>{classifyBusinessFailure(pointsQuery.error) === "resource-denied" ? "暂无权限查看自提点" : "自提点加载失败"}</p>
          <p>{pointsQuery.error.message}</p>
          <button type="button" className="crm-btn mt-3" onClick={() => void pointsQuery.refetch()}>重新加载</button>
        </div>
      ) : isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : points.length === 0 && !editing ? (
        <div className="mt-4 rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          暂无自提点
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {points.map(point => (
            <div key={point.id} className="flex gap-3 rounded-md border p-4">
              <MapPin className="mt-0.5 shrink-0 text-blue-600" size={18} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{point.name}</span>
                  <span
                    className={`text-xs ${point.enabled ? "text-emerald-600" : "text-slate-400"}`}
                  >
                    {point.enabled ? "启用" : "停用"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{point.address}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {point.contactName}　{point.contactPhone}
                  {point.businessHours ? `　${point.businessHours}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded p-2 text-slate-500 hover:bg-slate-100"
                  onClick={() => startEdit(point)}
                  aria-label="编辑自提点"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className="rounded p-2 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (window.confirm(`删除“${point.name}”？`))
                      remove.mutate({ id: point.id });
                  }}
                  aria-label="删除自提点"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {approved && !pointsQuery.isError && editing && (
        <div className="mt-4 rounded-md border bg-slate-50 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[13px] text-[#233548]">
              名称
              <input
                className="crm-input mt-1 h-9 w-full"
                value={editing.name}
                onChange={event =>
                  setEditing({ ...editing, name: event.target.value })
                }
                placeholder="如：深圳仓"
              />
            </label>
            <label className="text-[13px] text-[#233548]">
              时间
              <input
                className="crm-input mt-1 h-9 w-full"
                value={editing.businessHours}
                onChange={event =>
                  setEditing({ ...editing, businessHours: event.target.value })
                }
                placeholder="如：工作日 9:00-18:00"
              />
            </label>
            <label className="text-[13px] text-[#233548] md:col-span-2">
              地址
              <input
                className="crm-input mt-1 h-9 w-full"
                value={editing.address}
                onChange={event =>
                  setEditing({ ...editing, address: event.target.value })
                }
                placeholder="详细提货地址"
              />
            </label>
            <label className="text-[13px] text-[#233548]">
              联系人
              <input
                className="crm-input mt-1 h-9 w-full"
                value={editing.contactName}
                onChange={event =>
                  setEditing({ ...editing, contactName: event.target.value })
                }
              />
            </label>
            <label className="text-[13px] text-[#233548]">
              电话
              <input
                className="crm-input mt-1 h-9 w-full"
                value={editing.contactPhone}
                onChange={event =>
                  setEditing({ ...editing, contactPhone: event.target.value })
                }
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-[#233548]">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={event =>
                setEditing({ ...editing, enabled: event.target.checked })
              }
            />
            启用
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="crm-btn h-9"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={save.isPending}
              className="crm-btn crm-btn-primary h-9 disabled:opacity-50"
              onClick={submit}
            >
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}
      </div> : null}
    </section>
  );
}

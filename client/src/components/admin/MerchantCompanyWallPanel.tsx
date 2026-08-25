import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Images, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const CATEGORY_OPTIONS = [
  { value: "storefront", label: "公司门头" },
  { value: "office", label: "办公环境" },
  { value: "warehouse", label: "仓库" },
  { value: "production", label: "生产环境" },
  { value: "team", label: "团队风采" },
  { value: "other", label: "其他" },
] as const;

type Category = typeof CATEGORY_OPTIONS[number]["value"];
type WallPhoto = {
  id: number;
  url: string;
  name: string | null;
  category: Category;
  caption: string | null;
  status: "pending" | "approved" | "rejected";
  sortOrder: number;
};

const SAFE_COMPANY_WALL_ERRORS = [
  "仅支持 JPG、PNG 和 WebP 图片",
  "单张照片不能超过 8MB",
  "公司信息墙最多上传 9 张图片",
  "您无权管理该公司的信息墙",
  "该商户尚未关联企业资料，暂不能上传图片",
  "商户不存在或不在您负责的范围内",
  "图片内容与文件格式不一致",
] as const;

function companyWallErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return SAFE_COMPANY_WALL_ERRORS.find(item => message.includes(item)) ?? fallback;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function PhotoEditor({
  merchantId,
  photo,
  index,
  total,
  onMove,
}: {
  merchantId: number;
  photo: WallPhoto;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<Category>(photo.category);
  const [caption, setCaption] = useState(photo.caption || "");
  const updateMutation = trpc.merchant.updateCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success("照片展示信息已更新");
    },
    onError: error => toast.error("更新失败", { description: companyWallErrorMessage(error, "图片信息保存失败，请稍后重试") }),
  });
  const deleteMutation = trpc.merchant.deleteCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success("照片已从信息墙移除");
    },
    onError: error => toast.error("删除失败", { description: companyWallErrorMessage(error, "图片删除失败，请稍后重试") }),
  });

  useEffect(() => {
    setCategory(photo.category);
    setCaption(photo.caption || "");
  }, [photo.category, photo.caption]);

  const save = (status: "approved" | "rejected" = photo.status === "approved" ? "approved" : "rejected") => {
    updateMutation.mutate({
      id: merchantId,
      photoId: photo.id,
      category,
      caption: caption.trim() || null,
      sortOrder: photo.sortOrder,
      status,
    });
  };

  return (
    <article className="overflow-hidden rounded-lg border bg-white">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img src={photo.url} alt={caption || photo.name || "公司照片"} className="h-full w-full object-cover" />
        <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-medium ${
          photo.status === "approved" ? "bg-emerald-600 text-white" : "bg-slate-800 text-white"
        }`}>
          {photo.status === "approved" ? "前台展示" : "已隐藏"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <select
          value={category}
          onChange={event => setCategory(event.target.value as Category)}
          className="h-9 w-full rounded-md border bg-background px-2 text-xs">
          {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <Input value={caption} maxLength={120} onChange={event => setCaption(event.target.value)} placeholder="照片说明" className="h-9 text-xs" />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-8 flex-1 px-2 text-xs" disabled={updateMutation.isPending} onClick={() => save()}>
            <Save className="mr-1 h-3.5 w-3.5" /> 保存
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 px-2 text-xs"
            disabled={updateMutation.isPending}
            onClick={() => save(photo.status === "approved" ? "rejected" : "approved")}>
            {photo.status === "approved" ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
            {photo.status === "approved" ? "隐藏" : "公开"}
          </Button>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label="向前排序">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index >= total - 1} onClick={() => onMove(index, index + 1)} aria-label="向后排序">
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ id: merchantId, photoId: photo.id })}
            aria-label="删除照片">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export default function MerchantCompanyWallPanel({ merchantId }: { merchantId: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<Category>("office");
  const [caption, setCaption] = useState("");
  const wallQuery = trpc.merchant.companyWall.useQuery({ id: merchantId }, { retry: false });
  const uploadMutation = trpc.merchant.uploadCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      setCaption("");
      toast.success("公司照片已上传", { description: "企业公开主页已同步更新" });
    },
    onError: error => toast.error("上传失败", { description: companyWallErrorMessage(error, "图片上传失败，请稍后重试") }),
  });
  const reorderMutation = trpc.merchant.reorderCompanyWallPhotos.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success("照片顺序已更新");
    },
    onError: error => toast.error("排序失败", { description: companyWallErrorMessage(error, "图片排序失败，请稍后重试") }),
  });

  const photos = (wallQuery.data?.photos ?? []) as WallPhoto[];
  const onMove = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const ids = photos.map(photo => photo.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderMutation.mutate({ id: merchantId, photoIds: ids });
  };

  const selectFile = async (file: File) => {
    if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
      toast.error("仅支持 JPG、PNG 和 WebP 图片");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("单张照片不能超过 8MB");
      return;
    }
    try {
      await uploadMutation.mutateAsync({
        id: merchantId,
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64: await toBase64(file),
        category,
        caption: caption.trim() || undefined,
      });
    } catch {
      // mutation 已统一展示错误。
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Images className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-semibold">公司信息墙</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">协助企业维护公开主页照片；操作会记录后台审计。</p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{photos.length}/9</span>
      </div>

      {!wallQuery.data?.available ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">前台企业数据源暂不可用，请稍后重试。</div>
      ) : !wallQuery.data?.companyId ? (
        <div className="mt-4 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">该商户尚未关联前台企业资料，暂不能维护信息墙。</div>
      ) : (
        <>
          <div className="mt-4 space-y-2 rounded-lg border border-dashed bg-muted/30 p-3">
            <select value={category} onChange={event => setCategory(event.target.value as Category)} className="h-9 w-full rounded-md border bg-background px-2 text-xs">
              {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Input value={caption} maxLength={120} onChange={event => setCaption(event.target.value)} placeholder="照片说明（选填）" className="h-9 text-xs" />
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void selectFile(file);
              }}
            />
            <Button className="w-full" size="sm" disabled={photos.length >= 9 || uploadMutation.isPending} onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-4 w-4" /> {uploadMutation.isPending ? "上传中…" : "上传公司照片"}
            </Button>
          </div>

          {wallQuery.isLoading ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
            </div>
          ) : photos.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {photos.map((photo, index) => (
                <PhotoEditor key={photo.id} merchantId={merchantId} photo={photo} index={index} total={photos.length} onMove={onMove} />
              ))}
            </div>
          ) : (
            <div className="mt-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed text-center text-muted-foreground">
              <ImagePlus className="h-6 w-6 opacity-40" />
              <p className="mt-2 text-xs">暂无公司照片</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

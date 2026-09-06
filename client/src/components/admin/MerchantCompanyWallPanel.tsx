import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createCompanyPhotoThumbnail } from "@/lib/companyPhotoImage";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Images,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
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

type Category = (typeof CATEGORY_OPTIONS)[number]["value"];
type WallPhoto = {
  id: number;
  url: string;
  thumbnailUrl: string | null;
  name: string | null;
  category: Category;
  caption: string | null;
  status: "pending" | "approved" | "rejected";
  sortOrder: number;
};

type DisplayKind = "home" | "search";

const WALL_OPEN_KEY = "51admin:merchant-company-wall:open";
const SAFE_COMPANY_WALL_ERRORS = [
  "仅支持 JPG、PNG 和 WebP 图片",
  "单张照片不能超过 8MB",
  "公司信息墙最多上传 9 张图片",
  "您无权管理该公司的信息墙",
  "该商户尚未关联企业资料，暂不能上传图片",
  "商户不存在或不在您负责的范围内",
  "图片内容与文件格式不一致",
  "展示图已被其他员工修改，请刷新后重试",
  "只能选择该企业已公开的照片",
] as const;

function categoryLabel(category: Category) {
  return (
    CATEGORY_OPTIONS.find(option => option.value === category)?.label ?? "其他"
  );
}

function companyWallErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return (
    SAFE_COMPANY_WALL_ERRORS.find(item => message.includes(item)) ?? fallback
  );
}

function photoDisplayUrl(url: string, id: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}photo=${id}`;
}

function photoLabel(photo: WallPhoto) {
  const detail = photo.caption?.trim() || photo.name?.trim();
  return detail
    ? `${categoryLabel(photo.category)} · ${detail}`
    : categoryLabel(photo.category);
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(
        value.includes(",") ? value.slice(value.indexOf(",") + 1) : value
      );
    };
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function PhotoCard({
  merchantId,
  photo,
  isHomeCover,
  isSearchDisplay,
  index,
  total,
  onMove,
}: {
  merchantId: number;
  photo: WallPhoto;
  isHomeCover: boolean;
  isSearchDisplay: boolean;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<Category>(photo.category);
  const [caption, setCaption] = useState(photo.caption || "");
  const updateMutation = trpc.merchant.updateCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      setEditing(false);
      toast.success("照片信息已更新");
    },
    onError: error =>
      toast.error("更新失败", {
        description: companyWallErrorMessage(
          error,
          "图片信息保存失败，请稍后重试"
        ),
      }),
  });
  const deleteMutation = trpc.merchant.deleteCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success("照片已从信息墙移除");
    },
    onError: error =>
      toast.error("删除失败", {
        description: companyWallErrorMessage(error, "图片删除失败，请稍后重试"),
      }),
  });

  useEffect(() => {
    setCategory(photo.category);
    setCaption(photo.caption || "");
  }, [photo.category, photo.caption]);

  const save = (
    status: "approved" | "rejected" = photo.status === "approved"
      ? "approved"
      : "rejected"
  ) => {
    updateMutation.mutate({
      id: merchantId,
      photoId: photo.id,
      category,
      caption: caption.trim() || null,
      sortOrder: photo.sortOrder,
      status,
    });
  };

  const selectedUsage = [
    isHomeCover ? "首页图" : "",
    isSearchDisplay ? "搜索图" : "",
  ]
    .filter(Boolean)
    .join("和");
  const confirmSelectedImpact = (action: "隐藏" | "删除") =>
    !selectedUsage ||
    window.confirm(
      `${action}后将同时取消该照片的${selectedUsage}设置，是否继续？`
    );

  return (
    <article
      className={`overflow-hidden rounded-lg border bg-white ${isHomeCover || isSearchDisplay ? "border-primary/45 ring-1 ring-primary/10" : ""}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={photoDisplayUrl(photo.thumbnailUrl || photo.url, photo.id)}
          alt={photo.caption || photo.name || "公司照片"}
          loading="lazy"
          decoding="async"
          onError={event => {
            const originalUrl = photoDisplayUrl(photo.url, photo.id);
            if (event.currentTarget.src !== originalUrl)
              event.currentTarget.src = originalUrl;
            else event.currentTarget.onerror = null;
          }}
          className="h-full w-full object-cover"
        />
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-medium ${
            photo.status === "approved"
              ? "bg-emerald-600 text-white"
              : "bg-slate-700 text-white"
          }`}
        >
          {photo.status === "approved" ? "已公开" : "已隐藏"}
        </span>
        {(isHomeCover || isSearchDisplay) && (
          <span className="absolute bottom-2 left-2 flex flex-wrap gap-1">
            {isHomeCover && (
              <span className="rounded-full bg-[#185FA5] px-2 py-1 text-[10px] font-medium text-white">
                首页图
              </span>
            )}
            {isSearchDisplay && (
              <span className="rounded-full bg-white/95 px-2 py-1 text-[10px] font-medium text-[#185FA5] shadow-sm">
                搜索图
              </span>
            )}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-2 top-2 h-8 w-8 bg-white/95"
              aria-label="照片更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              编辑说明
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => onMove(index, index - 1)}
            >
              <ChevronUp className="mr-2 h-4 w-4" />
              向前排序
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index >= total - 1}
              onSelect={() => onMove(index, index + 1)}
            >
              <ChevronDown className="mr-2 h-4 w-4" />
              向后排序
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={deleteMutation.isPending}
              onSelect={() => {
                if (!confirmSelectedImpact("删除")) return;
                deleteMutation.mutate({ id: merchantId, photoId: photo.id });
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除照片
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="p-3">
        {editing ? (
          <div className="space-y-2">
            <select
              value={category}
              onChange={event => setCategory(event.target.value as Category)}
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              {CATEGORY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Input
              value={caption}
              maxLength={120}
              onChange={event => setCaption(event.target.value)}
              placeholder="照片说明（选填）"
              className="h-9 text-xs"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 flex-1"
                disabled={updateMutation.isPending}
                onClick={() => save()}
              >
                保存
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 flex-1"
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#185FA5]">
                  {categoryLabel(photo.category)}
                </p>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                  {photo.caption || photo.name || "暂无说明"}
                </p>
              </div>
              <button
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => {
                  if (
                    photo.status === "approved" &&
                    !confirmSelectedImpact("隐藏")
                  )
                    return;
                  save(photo.status === "approved" ? "rejected" : "approved");
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {photo.status === "approved" ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {photo.status === "approved" ? "隐藏" : "公开"}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

export default function MerchantCompanyWallPanel({
  merchantId,
}: {
  merchantId: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(
    () =>
      typeof window === "undefined" ||
      window.localStorage.getItem(WALL_OPEN_KEY) !== "closed"
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [category, setCategory] = useState<Category>("office");
  const [caption, setCaption] = useState("");
  const wallQuery = trpc.merchant.companyWall.useQuery(
    { id: merchantId },
    { retry: false }
  );
  const displayMutation = trpc.merchant.setCompanyWallDisplay.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success(
        variables.kind === "home" ? "首页展示图已更新" : "搜索展示图已更新"
      );
    },
    onError: error =>
      toast.error("展示图更新失败", {
        description: companyWallErrorMessage(
          error,
          "展示图保存失败，请稍后重试"
        ),
      }),
  });
  const uploadMutation = trpc.merchant.uploadCompanyWallPhoto.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      setCaption("");
      setUploadOpen(false);
      toast.success("公司照片已上传", {
        description: "照片已公开，可继续设置首页图或搜索图",
      });
    },
    onError: error =>
      toast.error("上传失败", {
        description: companyWallErrorMessage(error, "图片上传失败，请稍后重试"),
      }),
  });
  const reorderMutation = trpc.merchant.reorderCompanyWallPhotos.useMutation({
    onSuccess: async () => {
      await utils.merchant.companyWall.invalidate({ id: merchantId });
      toast.success("照片顺序已更新");
    },
    onError: error =>
      toast.error("排序失败", {
        description: companyWallErrorMessage(error, "图片排序失败，请稍后重试"),
      }),
  });

  useEffect(() => {
    window.localStorage.setItem(WALL_OPEN_KEY, open ? "open" : "closed");
  }, [open]);

  const photos = (wallQuery.data?.photos ?? []) as WallPhoto[];
  const approvedPhotos = photos.filter(photo => photo.status === "approved");
  const homeCoverPhotoId = wallQuery.data?.homeCoverPhotoId ?? null;
  const avatarPhotoId = wallQuery.data?.avatarPhotoId ?? null;
  const homeCoverPhoto =
    approvedPhotos.find(photo => photo.id === homeCoverPhotoId) ?? null;
  const avatarPhoto =
    approvedPhotos.find(photo => photo.id === avatarPhotoId) ?? null;

  const onMove = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const ids = photos.map(photo => photo.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderMutation.mutate({ id: merchantId, photoIds: ids });
  };

  const updateDisplay = (kind: DisplayKind, value: string) => {
    const nextPhotoId = value === "none" ? null : Number(value);
    const expectedPhotoId = kind === "home" ? homeCoverPhotoId : avatarPhotoId;
    if (nextPhotoId === expectedPhotoId || displayMutation.isPending) return;
    displayMutation.mutate({
      id: merchantId,
      kind,
      photoId: nextPhotoId,
      expectedPhotoId,
      ...(kind === "search"
        ? {
            displayMode: "photo" as const,
            crop: { zoom: 1, offsetX: 0, offsetY: 0 },
          }
        : {}),
    });
  };

  const selectFile = async (file: File) => {
    if (!"image/jpeg,image/png,image/webp".split(",").includes(file.type)) {
      toast.error("仅支持 JPG、PNG 和 WebP 图片");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("单张照片不能超过 8MB");
      return;
    }
    try {
      const [base64, thumbnail] = await Promise.all([
        toBase64(file),
        createCompanyPhotoThumbnail(file),
      ]);
      await uploadMutation.mutateAsync({
        id: merchantId,
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64,
        thumbnailBase64: thumbnail.base64,
        category,
        caption: caption.trim() || undefined,
      });
    } catch {
      // mutation 已统一展示业务错误。
    }
  };

  return (
    <section className="rounded-xl border bg-white shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 rounded-xl p-5 text-left hover:bg-muted/20"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Images className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">公司照片墙</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {homeCoverPhoto
                ? `首页图：${photoLabel(homeCoverPhoto)}`
                : "首页图：未设置"}
              <span className="mx-2">·</span>
              {avatarPhoto
                ? `搜索图：${photoLabel(avatarPhoto)}`
                : "搜索图：未设置"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {photos.length}/9
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t p-5">
          {wallQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map(item => (
                <div
                  key={item}
                  className="aspect-[4/3] animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          ) : !wallQuery.data?.available ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              前台企业数据源暂不可用，请稍后重试。
            </div>
          ) : !wallQuery.data?.companyId ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              该商户尚未关联前台企业资料，暂不能维护信息墙。
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-3 rounded-lg border bg-[#f8fbfe] p-3">
                  <span className="aspect-[16/9] overflow-hidden rounded-md border bg-white">
                    {homeCoverPhoto ? (
                      <img
                        src={photoDisplayUrl(
                          homeCoverPhoto.thumbnailUrl || homeCoverPhoto.url,
                          homeCoverPhoto.id
                        )}
                        alt="当前首页展示图"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-xs text-muted-foreground">
                        未设置
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      首页展示图
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      宽幅铺满首页供应商卡片
                    </span>
                    <select
                      aria-label="选择首页展示图"
                      value={homeCoverPhotoId ?? "none"}
                      onChange={event =>
                        updateDisplay("home", event.target.value)
                      }
                      disabled={displayMutation.isPending}
                      className="mt-2 h-9 w-full rounded-md border bg-white px-2 text-xs"
                    >
                      <option value="none">
                        未设置（自动使用首张公开照片）
                      </option>
                      {approvedPhotos.map(photo => (
                        <option key={photo.id} value={photo.id}>
                          {photoLabel(photo)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>

                <label className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 rounded-lg border bg-[#f8fbfe] p-3">
                  <span className="aspect-[4/3] overflow-hidden rounded-md border bg-white">
                    {avatarPhoto ? (
                      <img
                        src={photoDisplayUrl(
                          avatarPhoto.thumbnailUrl || avatarPhoto.url,
                          avatarPhoto.id
                        )}
                        alt="当前搜索展示图"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-xs text-muted-foreground">
                        未设置
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      搜索展示图
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      PC及手机网页统一按4:3显示
                    </span>
                    <select
                      aria-label="选择搜索展示图"
                      value={avatarPhotoId ?? "none"}
                      onChange={event =>
                        updateDisplay("search", event.target.value)
                      }
                      disabled={displayMutation.isPending}
                      className="mt-2 h-9 w-full rounded-md border bg-white px-2 text-xs"
                    >
                      <option value="none">未设置（使用Logo或默认图）</option>
                      {approvedPhotos.map(photo => (
                        <option key={photo.id} value={photo.id}>
                          {photoLabel(photo)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-dashed bg-muted/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium"
                  aria-expanded={uploadOpen}
                  onClick={() => setUploadOpen(value => !value)}
                >
                  <span className="inline-flex items-center gap-2">
                    <Upload className="h-4 w-4 text-primary" />
                    上传公司照片
                  </span>
                  {uploadOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {uploadOpen && (
                  <div className="grid gap-3 border-t p-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
                    <label className="text-xs font-medium">
                      照片分类
                      <select
                        value={category}
                        onChange={event =>
                          setCategory(event.target.value as Category)
                        }
                        className="mt-1.5 h-9 w-full rounded-md border bg-background px-2 text-xs"
                      >
                        {CATEGORY_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium">
                      照片说明（选填）
                      <Input
                        value={caption}
                        maxLength={120}
                        onChange={event => setCaption(event.target.value)}
                        placeholder="如：深圳仓库实景"
                        className="mt-1.5 h-9 text-xs"
                      />
                    </label>
                    <div>
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
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          photos.length >= 9 || uploadMutation.isPending
                        }
                        onClick={() => inputRef.current?.click()}
                      >
                        <ImagePlus className="mr-1.5 h-4 w-4" />
                        {uploadMutation.isPending ? "上传中…" : "选择并上传"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">照片库</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    公开照片才会进入两个展示图下拉框；其他操作收纳在卡片右上角。
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  已公开 {approvedPhotos.length} 张
                </span>
              </div>

              {photos.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {photos.map((photo, index) => (
                    <PhotoCard
                      key={photo.id}
                      merchantId={merchantId}
                      photo={photo}
                      isHomeCover={photo.id === homeCoverPhotoId}
                      isSearchDisplay={photo.id === avatarPhotoId}
                      index={index}
                      total={photos.length}
                      onMove={onMove}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed text-center text-muted-foreground">
                  <ImagePlus className="h-6 w-6 opacity-40" />
                  <p className="mt-2 text-xs">暂无公司照片</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

import { Check, ImagePlus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import CompanyPhotoCropEditor from "./CompanyPhotoCropEditor";
import { companyPhotoCropStyle } from "../lib/companyPhotoCrop";
import {
  createCompanyPhotoThumbnail,
  type CompanyAvatarCrop,
  type CompanyAvatarDisplayMode,
} from "../lib/companyPhotoImage";
import { trpc } from "../../../../api/business-trpc";
import { classifyBusinessFailure } from "../../../../BusinessWorkbenchSession";

const CATEGORY_OPTIONS = [
  { value: "storefront", label: "公司门头" },
  { value: "office", label: "办公环境" },
  { value: "warehouse", label: "仓库" },
  { value: "production", label: "生产环境" },
  { value: "team", label: "团队风采" },
  { value: "other", label: "其他" },
] as const;

type Category = typeof CATEGORY_OPTIONS[number]["value"];
const DEFAULT_DISPLAY_CROP: CompanyAvatarCrop = { zoom: 1, offsetX: 0, offsetY: 0 };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function categoryLabel(category: string) {
  return CATEGORY_OPTIONS.find(option => option.value === category)?.label || "公司照片";
}

function validImageFile(file: File) {
  if (!( ["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
    toast.error("仅支持 JPG、PNG 和 WebP 图片");
    return false;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.error("单张图片不能超过 8MB");
    return false;
  }
  return true;
}

function displayImageStyle(
  mode: CompanyAvatarDisplayMode,
  crop: CompanyAvatarCrop,
): CSSProperties | undefined {
  if (mode !== "photo") return undefined;
  return companyPhotoCropStyle(crop);
}

export default function CompanyPhotoWall() {
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<Category>("office");
  const [caption, setCaption] = useState("");
  const [editorPhotoId, setEditorPhotoId] = useState<number | null>(null);
  const [editorTarget, setEditorTarget] = useState<"search" | "home">("search");
  const [editorMode, setEditorMode] = useState<CompanyAvatarDisplayMode>("photo");
  const [editorCrop, setEditorCrop] = useState<CompanyAvatarCrop>(DEFAULT_DISPLAY_CROP);
  const photosQuery = trpc.company.profilePhotos.useQuery(undefined, { retry: false });

  const refresh = async () => {
    await utils.company.profilePhotos.invalidate();
  };
  const refreshPublicImages = () => {
    window.localStorage.removeItem("51dianzi:home-suppliers:v1");
    window.localStorage.removeItem("51dianzi:home-suppliers:v2");
    void utils.search.search.invalidate();
    void utils.company.publicProfile.invalidate();
    void utils.company.featuredSuppliers.invalidate();
  };
  const uploadMutation = trpc.company.uploadProfilePhoto.useMutation({
    onSuccess: async () => {
      await refresh();
      setCaption("");
      toast.success("公司照片已上传");
    },
    onError: error => toast.error("上传失败", { description: error.message }),
  });
  const setDisplayMutation = trpc.company.setProfileAvatar.useMutation({
    onSuccess: async (_data, variables) => {
      await refresh();
      setEditorPhotoId(null);
      refreshPublicImages();
      toast.success(variables.photoId ? "搜索展示图已更新" : "搜索展示图已取消");
    },
    onError: error => toast.error("设置失败", { description: error.message }),
  });
  const setHomeCoverMutation = trpc.company.setProfileHomeCover.useMutation({
    onSuccess: async (_data, variables) => {
      await refresh();
      setEditorPhotoId(null);
      refreshPublicImages();
      toast.success(variables.photoId ? "公司展示主图已更新" : "公司展示主图已取消");
    },
    onError: error => toast.error("设置失败", { description: error.message }),
  });
  const deleteMutation = trpc.company.deleteProfilePhoto.useMutation({
    onSuccess: async () => {
      await refresh();
      refreshPublicImages();
      toast.success("照片已移除");
    },
    onError: error => toast.error("删除失败", { description: error.message }),
  });

  const photos = photosQuery.data?.photos ?? [];
  const avatarPhotoId = photosQuery.data?.avatarPhotoId ?? null;
  const avatarPhoto = photosQuery.data?.avatarPhoto ?? null;
  const homeCoverPhotoId = photosQuery.data?.homeCoverPhotoId ?? null;
  const homeCoverPhoto = photosQuery.data?.homeCoverPhoto ?? null;
  const homeCoverDisplayMode: CompanyAvatarDisplayMode = photosQuery.data?.homeCoverDisplayMode === "logo" ? "logo" : "photo";
  const homeCoverCrop: CompanyAvatarCrop = photosQuery.data?.homeCoverCrop ?? DEFAULT_DISPLAY_CROP;
  const avatarDisplayMode: CompanyAvatarDisplayMode = photosQuery.data?.avatarDisplayMode === "photo" ? "photo" : "logo";
  const avatarCrop: CompanyAvatarCrop = photosQuery.data?.avatarCrop ?? DEFAULT_DISPLAY_CROP;
  const editorPhoto = photos.find(photo => photo.id === editorPhotoId) ?? null;
  const editorSaving = setDisplayMutation.isPending || setHomeCoverMutation.isPending;
  const [editorImageFailed, setEditorImageFailed] = useState(false);
  const [editorImageReady, setEditorImageReady] = useState(false);
  const limit = photosQuery.data?.limit ?? 9;
  const canUpload = !photosQuery.isLoading && !photosQuery.isError && photos.length < limit;

  useEffect(() => {
    if (editorPhotoId === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editorSaving) setEditorPhotoId(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [editorPhotoId, editorSaving]);

  const uploadFile = async (file: File) => {
    if (!validImageFile(file)) return;
    const [base64, thumbnail] = await Promise.all([
      fileToBase64(file),
      createCompanyPhotoThumbnail(file),
    ]);
    await uploadMutation.mutateAsync({
      fileName: file.name,
      base64,
      thumbnailBase64: thumbnail.base64,
      mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
      category,
      caption: caption.trim() || undefined,
    });
  };

  const openDisplayEditor = (photo: (typeof photos)[number]) => {
    const isCurrent = photo.id === avatarPhotoId;
    setEditorTarget("search");
    setEditorPhotoId(photo.id);
    setEditorImageFailed(false);
    setEditorImageReady(false);
    setEditorMode(isCurrent ? avatarDisplayMode : photo.category === "other" ? "logo" : "photo");
    setEditorCrop(isCurrent ? avatarCrop : DEFAULT_DISPLAY_CROP);
  };

  const openHomeCoverEditor = (photo: (typeof photos)[number]) => {
    const isCurrent = photo.id === homeCoverPhotoId;
    setEditorTarget("home");
    setEditorPhotoId(photo.id);
    setEditorImageFailed(false);
    setEditorImageReady(false);
    setEditorMode(isCurrent ? homeCoverDisplayMode : photo.category === "other" ? "logo" : "photo");
    setEditorCrop(isCurrent ? homeCoverCrop : DEFAULT_DISPLAY_CROP);
  };

  const saveDisplay = () => {
    if (!editorPhotoId || editorSaving || editorImageFailed || !editorImageReady) return;
    if (editorTarget === "home") {
      setHomeCoverMutation.mutate({
        photoId: editorPhotoId,
        displayMode: editorMode,
        crop: editorCrop,
      });
      return;
    }
    setDisplayMutation.mutate({
      photoId: editorPhotoId,
      displayMode: editorMode,
      crop: editorCrop,
    });
  };

  const cancelDisplay = () => {
    setDisplayMutation.mutate({
      photoId: null,
      displayMode: avatarDisplayMode,
      crop: avatarCrop,
    });
  };

  const cancelHomeCover = () => {
    setHomeCoverMutation.mutate({
      photoId: null,
      displayMode: homeCoverDisplayMode,
      crop: homeCoverCrop,
    });
  };

  const closeEditor = () => {
    if (!editorSaving) setEditorPhotoId(null);
  };

  const deletePhoto = (photoId: number) => {
    const usedBySearch = photoId === avatarPhotoId;
    const usedByHome = photoId === homeCoverPhotoId;
    if (usedBySearch || usedByHome) {
      const usage = usedBySearch && usedByHome
        ? "搜索展示图和公司展示主图"
        : usedBySearch ? "搜索展示图" : "公司展示主图";
      const confirmed = window.confirm(`该照片正在作为${usage}。删除后将同时取消展示，是否继续？`);
      if (!confirmed) return;
    }
    deleteMutation.mutate({ photoId });
  };

  return (
    <section className="mt-4 rounded-lg border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-[#233548]">公司信息墙</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            上传公司照片，并分别设置首页公司展示主图和搜索展示图。
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {photos.length}/{limit} 张
        </span>
      </div>

      {photosQuery.isError ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>{classifyBusinessFailure(photosQuery.error) === "resource-denied" ? "暂无权限管理公司信息墙" : "公司信息墙加载失败"}</p>
          <p className="mt-2">{photosQuery.error.message}</p>
          <button type="button" className="crm-btn mt-3" onClick={() => void photosQuery.refetch()}>重新加载</button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-white p-4">
              <div className="relative grid aspect-video w-[120px] shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-inset ring-slate-200">
                {homeCoverPhoto ? (
                  <img
                    src={homeCoverPhoto.thumbnailUrl || homeCoverPhoto.url}
                    alt="当前公司展示主图"
                    className={`absolute inset-0 block h-full w-full ${homeCoverDisplayMode === "photo" ? "object-cover" : "object-contain"}`}
                    style={displayImageStyle(homeCoverDisplayMode, homeCoverCrop)}
                    onError={event => {
                      if (event.currentTarget.src !== homeCoverPhoto.url) event.currentTarget.src = homeCoverPhoto.url;
                      else event.currentTarget.onerror = null;
                    }}
                  />
                ) : (
                  <ImagePlus size={24} className="text-slate-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">公司展示主图</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {homeCoverPhoto ? "用于首页供应商卡片，按横向区域铺满显示。" : "尚未设置，首页暂时使用信息墙首张照片。"}
                </p>
              </div>
              {homeCoverPhoto && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openHomeCoverEditor(homeCoverPhoto)}
                    className="crm-btn crm-btn-primary h-9">
                    调整
                  </button>
                  <button
                    type="button"
                    disabled={setHomeCoverMutation.isPending}
                    onClick={cancelHomeCover}
                    className="crm-btn h-9 disabled:opacity-50">
                    取消主图
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-white p-4">
              <div className="relative grid aspect-[4/3] w-[96px] shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-inset ring-slate-200">
                {avatarPhoto ? (
                  <img
                    src={avatarPhoto.thumbnailUrl || avatarPhoto.url}
                    alt="当前搜索展示图"
                    className={`absolute inset-0 block h-full w-full ${avatarDisplayMode === "photo" ? "object-cover" : "object-contain"}`}
                    style={displayImageStyle(avatarDisplayMode, avatarCrop)}
                    onError={event => {
                      if (event.currentTarget.src !== avatarPhoto.url) event.currentTarget.src = avatarPhoto.url;
                      else event.currentTarget.onerror = null;
                    }}
                  />
                ) : (
                  <ImagePlus size={24} className="text-slate-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">搜索展示图</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {avatarPhoto ? "搜索列表和网格使用同一张 4:3 展示图。" : "尚未设置，请从下方照片中选择。"}
                </p>
              </div>
              {avatarPhoto && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openDisplayEditor(avatarPhoto)}
                    className="crm-btn crm-btn-primary h-9">
                    调整
                  </button>
                  <button
                    type="button"
                    disabled={setDisplayMutation.isPending}
                    onClick={cancelDisplay}
                    className="crm-btn h-9 disabled:opacity-50">
                    取消展示
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs font-medium text-slate-700">
              照片分类
              <select
                value={category}
                onChange={event => setCategory(event.target.value as Category)}
                className="crm-input mt-1.5 h-9 w-full">
                {CATEGORY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              照片说明（选填）
              <input
                value={caption}
                maxLength={120}
                onChange={event => setCaption(event.target.value)}
                placeholder="如：深圳仓库实景"
                className="crm-input mt-1.5 h-9 w-full"
              />
            </label>
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async event => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  try {
                    await uploadFile(file);
                  } catch {
                    // mutation 已统一展示业务错误。
                  }
                }}
              />
              <button
                type="button"
                disabled={!canUpload || uploadMutation.isPending}
                onClick={() => inputRef.current?.click()}
                className="crm-btn crm-btn-primary h-9 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                <Upload size={15} />
                {uploadMutation.isPending ? "上传中…" : "上传公司照片"}
              </button>
            </div>
          </div>

          {photosQuery.isLoading ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="aspect-[4/3] animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : photos.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map(photo => {
                const isDisplay = photo.id === avatarPhotoId;
                const isHomeCover = photo.id === homeCoverPhotoId;
                const previewMode = isDisplay ? avatarDisplayMode : isHomeCover ? homeCoverDisplayMode : "photo";
                const previewCrop = isDisplay ? avatarCrop : isHomeCover ? homeCoverCrop : DEFAULT_DISPLAY_CROP;
                return (
                  <article key={photo.id} className={`group overflow-hidden rounded-lg border bg-white ${isDisplay || isHomeCover ? "border-[#185FA5] ring-2 ring-[#185FA5]/15" : "border-slate-200"}`}>
                    <div className={`relative overflow-hidden bg-slate-100 ${isHomeCover && !isDisplay ? "aspect-video" : "aspect-[4/3]"}`}>
                      <img
                        src={photo.thumbnailUrl || photo.url}
                        alt={photo.caption || categoryLabel(photo.category)}
                        loading="lazy"
                        decoding="async"
                        onError={event => {
                          if (event.currentTarget.src !== photo.url) event.currentTarget.src = photo.url;
                          else event.currentTarget.onerror = null;
                        }}
                        className={`absolute inset-0 block h-full w-full ${previewMode === "logo" ? "object-contain" : "object-cover"}`}
                        style={isDisplay || isHomeCover ? displayImageStyle(previewMode, previewCrop) : undefined}
                      />
                      {(isHomeCover || isDisplay) && (
                        <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
                          {isHomeCover && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#185FA5] px-2 py-1 text-[11px] font-medium text-white shadow">
                              <Check size={12} /> 公司展示主图
                            </span>
                          )}
                          {isDisplay && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-medium text-[#185FA5] shadow">
                              <Check size={12} /> 搜索展示图
                            </span>
                          )}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="删除公司照片"
                        disabled={deleteMutation.isPending}
                        onClick={() => deletePhoto(photo.id)}
                        className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/90 text-red-600 opacity-0 shadow transition-opacity hover:bg-white group-hover:opacity-100 focus:opacity-100">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-[#185FA5]">{categoryLabel(photo.category)}</span>
                        <span className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={photo.status !== "approved" || setHomeCoverMutation.isPending}
                            onClick={() => openHomeCoverEditor(photo)}
                            className="text-[11px] font-medium text-[#185FA5] hover:underline disabled:cursor-not-allowed disabled:text-slate-400">
                            {isHomeCover ? "调整主图" : "设为主图"}
                          </button>
                          <button
                            type="button"
                            disabled={photo.status !== "approved" || setDisplayMutation.isPending}
                            onClick={() => openDisplayEditor(photo)}
                            className="text-[11px] font-medium text-[#185FA5] hover:underline disabled:cursor-not-allowed disabled:text-slate-400">
                            {isDisplay ? "调整搜索图" : "设为搜索图"}
                          </button>
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-slate-600">
                        {photo.caption || photo.name || "企业实景照片"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-center text-slate-500">
              <ImagePlus size={24} className="mb-2 text-slate-300" />
              <p className="text-sm">尚未上传公司照片</p>
              <p className="mt-1 text-xs">上传后可分别设置公司展示主图和搜索展示图</p>
            </div>
          )}
        </>
      )}

      {!photosQuery.isError && editorPhoto && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4" onClick={closeEditor}>
          <div className="max-h-[calc(100dvh-32px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="display-editor-title" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 id="display-editor-title" className="text-[13px] font-medium text-[#233548]">
                {editorTarget === "home" ? "设置公司展示主图" : "设置搜索展示图"}
              </h3>
              <button type="button" aria-label="关闭" disabled={editorSaving} onClick={closeEditor} className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={18} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 rounded-md border border-slate-300 bg-slate-50 p-1">
              <button type="button" disabled={editorSaving} onClick={() => { setEditorMode("logo"); setEditorCrop(DEFAULT_DISPLAY_CROP); }} className={`h-9 rounded text-xs font-medium disabled:opacity-40 ${editorMode === "logo" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}>完整显示</button>
              <button type="button" disabled={editorSaving} onClick={() => setEditorMode("photo")} className={`h-9 rounded text-xs font-medium disabled:opacity-40 ${editorMode === "photo" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}>裁切铺满</button>
            </div>
            <CompanyPhotoCropEditor
              key={`${editorTarget}-${editorPhoto.id}`}
              src={editorPhoto.url}
              target={editorTarget}
              mode={editorMode}
              crop={editorCrop}
              disabled={editorSaving || editorImageFailed}
              onChange={setEditorCrop}
              onReadyChange={setEditorImageReady}
              onImageError={() => setEditorImageFailed(true)}
            />
            <p className="mt-2 text-center text-xs text-slate-500">
              {editorTarget === "home" ? "首页主图按 16:9 显示" : "搜索页统一按 4:3 显示"}
            </p>
            {editorMode === "logo" && (
              <p className="mt-3 text-xs text-slate-500">适合 Logo，保留完整内容和安全留白。</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={editorSaving} onClick={closeEditor} className="h-9 rounded-md border border-slate-300 px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">取消</button>
              <button type="button" disabled={editorSaving || editorImageFailed || !editorImageReady} onClick={saveDisplay} className="crm-btn crm-btn-primary h-9 disabled:opacity-50">
                {editorSaving ? "保存中…" : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

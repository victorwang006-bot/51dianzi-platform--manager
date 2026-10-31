import { usePageMemory, useRememberedState, freshListOptions, useRestoringListQuery, returnToPageSource } from "../hooks/usePageMemory";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import PlatformLayout from "../../../../BusinessContentFrame";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { trpc } from "../../../../api/business-trpc";
import {
  EMPTY_FORM,
  InventoryFormFields,
  toPayload,
  validateForm,
  type FormState,
  type InventoryPhoto,
} from "./PublishInventory";

function itemToForm(item: {
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  dateCode: string | null;
  qtyOnSale: number;
  qtyOrder?: number | null;
  qtyStock: number;
  priceEx: string | null;
  taxIncluded: boolean;
  invoice: boolean;
  ladderPrices: { minQty: number; price: number }[] | null;
  moq: number | null;
  spq: number | null;
  leadTime: string | null;
  warehouseAddress: string | null;
  rohs: boolean;
  note: string | null;
  photos: InventoryPhoto[] | null;
}): FormState {
  return {
    ...EMPTY_FORM,
    partNumber: item.partNumber,
    brand: item.brand,
    category: item.category,
    pkg: item.pkg ?? "",
    dateCode: item.dateCode ?? "",
    qtyOnSale: String(item.qtyOnSale),
    qtyOrder: item.qtyOrder == null ? "" : String(item.qtyOrder),
    qtyStock: String(item.qtyStock),
    priceEx: item.priceEx == null ? "" : String(item.priceEx),
    taxIncluded: item.taxIncluded !== false,
    invoice: item.invoice,
    ladderPrices: (item.ladderPrices ?? []).map(tier => ({
      minQty: String(tier.minQty),
      price: String(tier.price),
    })),
    moq: item.moq ? String(item.moq) : "",
    spq: item.spq ? String(item.spq) : "",
    leadTime: item.leadTime ?? EMPTY_FORM.leadTime,
    warehouseAddress: item.warehouseAddress ?? "",
    rohs: item.rohs,
    note: item.note ?? "",
    photos: item.photos ?? [],
  };
}

export default function EditInventory() {
  const d51Ready = usePageMemory();

  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydratedId, setHydratedId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const itemQuery = trpc.inventory.get.useQuery(
    { id },
    { enabled: validId, retry: false }
  );

  useEffect(() => {
    if (itemQuery.data && hydratedId !== itemQuery.data.id) {
      setForm(itemToForm(itemQuery.data as Parameters<typeof itemToForm>[0]));
      setHydratedId(itemQuery.data.id);
    }
  }, [hydratedId, itemQuery.data]);

  /**
   * 当前编辑的是否为在售库存。
   *
   * 在售与待发布两种形态的语义差别很大，需在文案、按钮、返回位置
   * 上分别处理，否则用户会误以为修改在售商品需要再手动发布一次。
   */
  const isPublished = itemQuery.data?.status === "published";
  const isOffshelf = itemQuery.data?.status === "offshelf";

  const publishMutation = trpc.inventory.publish.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.get.invalidate({ id }),
      ]);
      if (!result.success) {
        toast.warning(
          isOffshelf ? "仍未上架，修改已保存" : "仍未发布，修改已保存",
          {
            description:
              result.message ??
              (isOffshelf
                ? "记录继续保留在已下架列表"
                : "记录继续保留在待发布列表"),
          }
        );
        return;
      }
      toast.success(isOffshelf ? "修改并重新上架成功" : "修改并发布成功", {
        description: "买家现在可检索到该型号",
      });
      returnToPageSource(navigate, "/inventory?status=published");
    },
    onError: error => toast.error(error.message),
  });

  const updateMutation = trpc.inventory.update.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.get.invalidate({ id }),
        // 在售编辑会改变 refreshedAt，刷新状态卡片需跟着失效
        utils.inventory.refreshStatus.invalidate(),
      ]);
      if (result.republished) {
        toast.success("已重新发布", {
          description: "修改已生效，本次操作计一次刷新，该型号已排到列表前列",
        });
        returnToPageSource(navigate, "/inventory");
        return;
      }
      publishMutation.mutate({ id });
    },
    onError: error => toast.error(error.message),
  });

  const handleSave = () => {
    // edit 模式：不强制要求批号，避免存量无批号库存无法修改价格
    const error = validateForm(form, "edit");
    if (error) {
      toast.error(error);
      return;
    }
    if (!validId || updateMutation.isPending || publishMutation.isPending)
      return;
    updateMutation.mutate({ id, data: toPayload(form) });
  };

  // 在售和已下架条目从「我的库存」进入；草稿仍回待发布列表。
  const backToList = () =>
    returnToPageSource(navigate, isPublished
        ? "/inventory?status=published"
        : isOffshelf
          ? "/inventory?status=offshelf"
          : "/publish?tab=list");
  const status = itemQuery.data?.status;
  const editable =
    status === "draft" || status === "offshelf" || status === "published";
  const unavailable =
    !validId || itemQuery.isError || (itemQuery.data != null && !editable);

  return (
    <PlatformLayout>
      <div className="erp-ui">
        <div className="mb-4 flex items-start gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-0.5 h-8 w-8 shrink-0"
            aria-label={
              isPublished || isOffshelf ? "返回我的库存" : "返回待发布列表"
            }
            onClick={backToList}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">
              {isPublished
                ? "编辑在售库存"
                : isOffshelf
                  ? "编辑已下架库存"
                  : "编辑库存"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {isPublished
                ? "修改后点「重新发布」即时生效，无需先下架；本次操作计一次刷新"
                : isOffshelf
                  ? "修改后点「保存并重新上架」；通过库存和重复型号校验后恢复展示"
                  : itemQuery.data?.publishErrorMessage
                    ? "请修改标红字段；保存后系统会自动重新发布，仍失败则继续保留"
                    : "修改后系统会立即尝试发布；仍失败则继续保留在待发布列表"}
            </p>
          </div>
        </div>

        {itemQuery.isLoading && validId ? (
          <Card className="max-w-[880px] space-y-5 p-6">
            <Skeleton className="h-5 w-28" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
            <Skeleton className="h-32 w-full" />
          </Card>
        ) : unavailable ? (
          <Card className="max-w-[680px] p-8 text-center">
            <TriangleAlert className="mx-auto h-9 w-9 text-amber-500" />
            <h2 className="mt-3 text-base font-semibold">
              {status && !editable
                ? "该库存当前不可编辑"
                : "无法打开该库存记录"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {status && !editable
                ? "该状态的库存暂不支持编辑。"
                : (itemQuery.error?.message ??
                  "记录不存在，或当前账号无权查看。")}
            </p>
            <Button
              className="mt-5 bg-[#185FA5] hover:bg-[#0C447C]"
              onClick={backToList}
            >
              {isPublished || isOffshelf ? "返回我的库存" : "返回待发布列表"}
            </Button>
          </Card>
        ) : (
          <Card className="max-w-[880px] p-4 sm:p-6">
            {itemQuery.data?.publishErrorMessage && (
              <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <div className="font-medium">上次发布失败</div>
                <div className="mt-1 text-xs leading-5">
                  {itemQuery.data.publishErrorMessage}
                </div>
              </div>
            )}
            <InventoryFormFields
              form={form}
              setForm={setForm}
              mode="edit"
              errorFields={itemQuery.data?.publishErrorFields ?? []}
            />
            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={updateMutation.isPending || publishMutation.isPending}
                onClick={backToList}
              >
                取消
              </Button>
              <Button
                type="button"
                className="bg-[#185FA5] hover:bg-[#0C447C]"
                disabled={updateMutation.isPending || publishMutation.isPending}
                onClick={handleSave}
              >
                {(updateMutation.isPending || publishMutation.isPending) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {isPublished
                  ? "重新发布"
                  : isOffshelf
                    ? "保存并重新上架"
                    : "修改并重新发布"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </PlatformLayout>
  );
}

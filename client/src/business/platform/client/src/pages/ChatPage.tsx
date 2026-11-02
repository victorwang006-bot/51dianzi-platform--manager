import { ChatEntryAuthWait, ChatEnterpriseWait } from "../components/ChatEntryWait";
import { readMarketQuoteChatDraft } from "../lib/marketQuoteChat";
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "../../../../api/business-trpc";
import { buildInquiryKey, parseSearchInquiry } from "../lib/searchInquiry";
import { createClientMessageId } from "../lib/clientMessageId";
import { createEnterpriseScopedTrpcClient } from "../lib/enterpriseTrpcClient";
import { clearSessionQueryCache, installAuthSessionClearListener } from "../lib/authSessionEvents";
import {
  isOperatingEnterprise,
  useEnterpriseSession,
} from "../contexts/EnterpriseSessionContext";
import { InquiryEnterpriseChooserDialog } from "../components/InquiryEnterpriseChooserDialog";
import { accountDisplayName } from "../lib/accountDisplayName";
import {
  createPublicReviewImage,
  PUBLIC_REVIEW_IMAGE_LIMIT,
  type PublicReviewImage,
} from "../lib/publicReviewImage";
import { createPublicReviewRequestId } from "../lib/publicReviewRequest";
import { useAuth } from "../../../../api/business-auth";
import UserAvatar from "../components/UserAvatar";
import { logoNav } from "../assets/logos";
import ImageLightbox from "../components/ImageLightbox";
import {
  BUSINESS_CHAT_STICKERS,
  EMOJI_CHAT_STICKERS,
  NOTO_CHAT_STICKERS,
  YAYATUAN_CHAT_STICKERS,
  chatBusinessPackIcon,
  chatEmojiPackIcon,
  chatNotoPackIcon,
  chatStickerPickerIcon,
  chatYayatuanPackIcon,
  getChatSticker,
  getRecentChatStickerIds,
  recordRecentChatSticker,
  type ChatStickerId,
} from "../assets/stickers/index";
import BrandImage from "../components/BrandImage";
import MallLoginDialog from "../components/MallLoginDialog";
import { Button } from "../components/ui/button";
import ServiceAvatar from "../components/ServiceAvatar";
import WeComServicePopover from "../components/WeComServicePopover";
import ChatUnreadBadge, { useChatUnreadDocumentTitle } from "../components/ChatUnreadBadge";
import ForumUnreadBadge, { useForumUnreadTotal } from "../components/ForumUnreadBadge";
import { MAIN_NAVIGATION_ITEMS } from "../lib/mainNavigation";
import ContactProfileSheet, {
  type ContactBlockState,
  type ContactProfileTarget,
} from "../components/ContactProfileSheet";
import { Archive, ArchiveRestore, ArrowDown, Combine, Copy, Image as ImageIcon, ImagePlus, Mail, MessageCircle, MoreHorizontal, Paperclip, Pin, Plus, Reply, RotateCcw, Trash2, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { formatBeijingDateTime, formatBeijingRelativeTime, formatBeijingTime } from "../../../shared/beijingTime";
import { inquiryQuantityText, legacyInquiryQuantityText } from "../../../shared/inquiryQuantity";
import {
  ERP_PERMISSION_DEFINITIONS,
  ERP_PERMISSION_KEYS,
  isErpPermissionKey,
  type ErpPermissionKey,
} from "../../../shared/erpPermissions";

// ─── Types ───
interface Conversation {
  id: number;
  otherUserId: number;
  otherUserName: string;
  otherUserOriginalName: string;
  /** 仅在对方满足企业公开页全部门禁时返回；用于生成 /company/:supplierId 链接。 */
  otherCompanyProfileSupplierId: number | null;
  /**
   * 对端是否为官方客服（51小电）。
   * 由服务端按客服用户 ID 判定，用于固定置顶与隐藏置顶开关。
   * 不能改用名称匹配：用户可以给任意会话设备注名为「51小电」，
   * 靠名称判定会让普通供应商会话被冒充为官方并置顶。
   */
  isService: boolean;
  remarkName: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  pinned: boolean;
  groupName: string | null;
  groupIds: number[];
  unreadCount: number;
}

interface ChatAttachment {
  id?: number;
  kind: "image" | "file";
  originalName: string;
  mimeType: string;
  byteSize: number;
  url: string | null;
}

interface Message {
  /** 服务端消息为 number；本地未送达消息为 `local:{clientMessageId}` */
  id: number | string;
  conversationId: number;
  senderId: number;
  /** 客户端幂等键，重试时复用同一个值；历史消息可为空 */
  clientMessageId?: string | null;
  msgType: "text" | "quote" | "sticker" | "image" | "file" | "inquiry" | "greeting" | "transfer_notice" | "handoff_notice" | "coffee_coupon" | "erp_invite" | "company_like";
  content: string;
  replyToMessageId?: number | null;
  replyTo?: {
    id: number;
    senderId: number | null;
    msgType: Message["msgType"] | null;
    content: string | null;
    unavailable: boolean;
  } | null;
  recalledAt?: Date | string | null;
  recalledByUserId?: number | null;
  createdAt: Date;
  attachment?: ChatAttachment | null;
  /** 仅本地附件重试使用；不会写入服务端或查询缓存。 */
  localFile?: File;
  uploadState?: "uploading" | "sending";
  /**
   * 本地发送状态。仅存在于尚未得到服务端确认的乐观消息，
   * 服务端返回的消息不带此字段（即已送达）。
   */
  deliveryState?: "sending" | "failed";
}

interface QuoteContent {
  partNumber: string;
  brand: string;
  qty: number;
  unit: string;
  price: number;
}

/** BOM 询价单卡片中的单行物料 */
interface BomInquiryItem {
  excelRow: number;
  partNumber: string;
  quantity: number;
  brand?: string;
  pkg?: string;
  reference?: string;
  note?: string;
  referencePrice?: string;
  aiPrice?: string;
}

// ─── Helpers ───
const AVATAR_COLORS = [
  "bg-gradient-to-br from-[#2B7AE8] to-[#185FA5]",
  "bg-gradient-to-br from-[#43a867] to-[#2d7a4f]",
  "bg-gradient-to-br from-[#f0893a] to-[#c9610d]",
  "bg-gradient-to-br from-[#9b59b6] to-[#6c3483]",
  "bg-gradient-to-br from-[#17a2b8] to-[#0d6675]",
];

function getAvatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function getInitial(name: string) {
  return name.charAt(0);
}

const CHAT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const CHAT_FILE_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"] as const;
const CHAT_FILE_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
};
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
const CHAT_MESSAGE_RECALL_WINDOW_MS = 10 * 60 * 1000;
const RECALLABLE_MESSAGE_TYPES = new Set<Message["msgType"]>(["text", "quote", "sticker", "image", "file"]);

function parseCardText(content: string, fallback: string) {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const candidate = value.text || value.partNumber || value.title || value.fileName;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
  } catch {
    return fallback;
  }
}

function messageActionText(message: Message): string {
  if (message.recalledAt) return "";
  if (message.msgType === "text") return message.content;
  if (message.msgType === "sticker") return getChatSticker(message.content)?.label || "表情";
  if (message.msgType === "image") return message.attachment?.originalName ? `[图片] ${message.attachment.originalName}` : "[图片]";
  if (message.msgType === "file") return message.attachment?.originalName ? `[文件] ${message.attachment.originalName}` : "[文件]";
  if (message.msgType === "quote") return `[报价单] ${parseCardText(message.content, "报价信息")}`;
  if (message.msgType === "inquiry") return `[询价单] ${parseCardText(message.content, "询价信息")}`;
  if (message.msgType === "handoff_notice") return `[业务交接] ${parseCardText(message.content, "询价已转交")}`;
  if (message.msgType === "transfer_notice") return `[转账通知] ${parseCardText(message.content, "对公转账通知")}`;
  if (message.msgType === "greeting") return parseCardText(message.content, "客服问候");
  if (message.msgType === "company_like") return "[公司主页获赞提醒]";
  if (message.msgType === "coffee_coupon") return "[ERP开通礼]";
  if (message.msgType === "erp_invite") return "[企业ERP邀请]";
  return "[消息]";
}

function compactMessageSummary(message: Message, maxLength = 72) {
  const text = messageActionText(message).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function messageReplyDescriptor(message: Message | null | undefined): NonNullable<Message["replyTo"]> | null {
  if (!message || typeof message.id !== "number" || message.recalledAt) return null;
  return {
    id: message.id,
    senderId: message.senderId,
    msgType: message.msgType,
    content: message.content,
    unavailable: false,
  };
}

function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("文件读取失败"));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatAttachmentBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeChatAttachmentUrl(raw: string | null | undefined) {
  if (!raw) return null;
  if (raw.startsWith("blob:")) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== "https:") return null;
    const sameOrigin = parsed.origin === window.location.origin;
    const viaOss = parsed.hostname.startsWith("dianzi51-assets.")
      && parsed.hostname.endsWith(".aliyuncs.com")
      && parsed.pathname.startsWith("/chat-attachments/");
    const viaProxy = sameOrigin && parsed.pathname.startsWith("/manus-storage/chat-attachments/");
    return viaOss || viaProxy ? parsed.href : null;
  } catch {
    return null;
  }
}

const CS_NAME = "51小电";

/** 客服名匹配（含历史"平台客服"命名） */
function isServiceName(name: string | null | undefined) {
  return name === CS_NAME || name === "平台客服";
}

/**
 * 会话列表的相对时间。统一走北京时间，
 * 避免访问者时区不同导致“今天”“昨天”判断错位。
 */
function formatTime(date: Date | string) {
  return formatBeijingRelativeTime(date);
}

/** 消息气泡的时分，固定北京时间。 */
function formatMsgTime(date: Date | string) {
  return formatBeijingTime(date);
}

/**
 * BOM 询价 Excel 下载链接的安全白名单。
 *
 * 卡片内容来自消息正文（JSON），属于可被构造的数据；如果直接渲染为链接，
 * 伪造的 fileUrl 就能在官方聊天窗口里变成一个看上去可信的钓鱼下载入口。
 * 因此只放行平台自己的询价文件路径，其余一律不渲染下载按钮。
 */
function safeBomInquiryFileUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    // 存储后端为 Forge 时：站内 /manus-storage/ 代理路径。
    const viaSiteProxy =
      parsed.hostname === "51dianzi.com"
      && parsed.pathname.startsWith("/manus-storage/bom-inquiries/");
    // 存储后端为阿里云 OSS 时：平台自有桶的绝对地址。
    // 仅放行 dianzi51-assets 桶且 /bom-inquiries/ 前缀，仍能拦住伪造的外部链接。
    const viaOssBucket =
      parsed.hostname.startsWith("dianzi51-assets.")
      && parsed.hostname.endsWith(".aliyuncs.com")
      && parsed.pathname.startsWith("/bom-inquiries/");
    return viaSiteProxy || viaOssBucket ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type InquiryDeliveryPhase = "checking" | "sent" | "unsent" | "pending" | "unavailable" | "login";

interface InquiryDeliveryState {
  phase: InquiryDeliveryPhase;
  inventoryId: number;
  userId: number;
  enterpriseId: number;
  key: string;
  conversationId?: number;
}

/**
 * The admin workbench may opt into the reception-only surface. The ordinary
 * front ChatPage deliberately receives no value and retains every original
 * personal/buyer flow.
 */
export type BusinessReceptionConfig = Readonly<{
  requiredPermission: "inquiry.receive";
  personalFlowMessages: Readonly<Record<string, string>>;
}>;

type ChatPageProps = {
  businessReception?: BusinessReceptionConfig;
  /** Wouter supplies this on front-route mounting; workbench direct mounting does not need it. */
  params?: { [routeParameter: number]: string | undefined };
};

type InquiryTransportFailure = "retryable" | "unauthorized" | "permanent" | "account_changed" | "enterprise_changed" | null;

/** A source-tab claim expires quickly and may only belong to its original buyer and inventory. */
export const INVENTORY_INQUIRY_AUTO_WINDOW_MS = 10 * 60 * 1000;
/** Initial request plus at most these two delayed, status-checked retries. */
export const INVENTORY_INQUIRY_RETRY_DELAYS_MS = [700, 1400] as const;

export function isFreshInventoryInquiryClaim(
  claim: unknown,
  buyerUserId: number,
  inventoryId: number,
  inquiryEnterpriseId: number,
  now = Date.now(),
) {
  if (!claim || typeof claim !== "object") return false;
  const candidate = claim as { buyerUserId?: unknown; inquiryEnterpriseId?: unknown; inventoryId?: unknown; at?: unknown };
  const claimedBuyerId = Number(candidate.buyerUserId);
  const claimedEnterpriseId = Number(candidate.inquiryEnterpriseId);
  const claimedInventoryId = Number(candidate.inventoryId);
  const claimedAt = Number(candidate.at);
  return Number.isInteger(buyerUserId)
    && buyerUserId > 0
    && Number.isInteger(inventoryId)
    && inventoryId > 0
    && claimedBuyerId === buyerUserId
    && claimedEnterpriseId === inquiryEnterpriseId
    && claimedInventoryId === inventoryId
    && Number.isFinite(claimedAt)
    && now >= claimedAt
    && now - claimedAt < INVENTORY_INQUIRY_AUTO_WINDOW_MS;
}

/** Only missing-code/network failures and the two transient server codes may be retried automatically. */
export function inventoryInquiryTransportFailure(error: unknown): Exclude<InquiryTransportFailure, "account_changed" | null> {
  const code = (error as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  if (code === "UNAUTHORIZED") return "unauthorized";
  return !code || code === "INTERNAL_SERVER_ERROR" || code === "TIMEOUT"
    ? "retryable"
    : "permanent";
}

function inquiryConversationId(result: { status: string; conversationId: number | null }) {
  const conversationId = Number(result.conversationId);
  return result.status === "sent" && Number.isSafeInteger(conversationId) && conversationId > 0
    ? conversationId
    : null;
}

// ─── Main Component ───
type ChatPageContentProps = ChatPageProps & {
  user: ReturnType<typeof useAuth>["user"];
  loading: boolean;
  /** The immutable buyer-enterprise snapshot used by every chat RPC in this body. */
  enterpriseScopeId: number | null;
};

function ChatPageContent({ businessReception, user, loading, enterpriseScopeId }: ChatPageContentProps) {
  const { logout } = useAuth();
  /*
   * 新标签页必须重新确认Cookie登录态。认证查询与受保护查询使用同一个
   * httpBatchLink；在认证仍加载时就挂载会话/分组查询，可以让服务端在
   * 同一批请求上下文里完成认证并行返回，避免 auth.me 完成后再多等一轮网络。
   * 未登录时这些查询只返回UNAUTHORIZED，页面仍按原逻辑显示登录框。
   */
  const receptionMode = businessReception !== undefined;
  const primeProtectedChatQueries = loading || Boolean(user);
  const hasCrm = Boolean((user as { crmAccess?: boolean } | null)?.crmAccess);
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [messageListAtBottom, setMessageListAtBottom] = useState(true);
  const [inquiryDelivery, setInquiryDelivery] = useState<InquiryDeliveryState | null>(null);

  const { data: cartCount } = trpc.cart.count.useQuery(undefined, {
    enabled: Boolean(user),
    refetchOnWindowFocus: true,
  });
  const enterpriseQuery = trpc.enterprise.me.useQuery(undefined, {
    enabled: Boolean(user) && hasCrm,
    retry: false,
    staleTime: 30_000,
  });
  const enterprisePermissions = new Set<ErpPermissionKey>(enterpriseQuery.data?.permissionKeys ?? []);
  const defaultErpPermission = ERP_PERMISSION_KEYS.find(key =>
    enterpriseQuery.data?.isOwner || enterprisePermissions.has(key));
  const chatErpHref = hasCrm
    ? defaultErpPermission
      ? ERP_PERMISSION_DEFINITIONS[defaultErpPermission].href
      : "/company"
    : "/crm-apply";
  // Forum unread is an employee's private/global state, not a reception
  // conversation resource. The hook remains normal for the front page.
  const { total: forumUnreadTotal } = useForumUnreadTotal(Boolean(user) && !receptionMode);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // URL params
  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const inquiryIntent = useMemo(() => parseSearchInquiry(params), [params]);
  const quoteChatDraft = useMemo(() => readMarketQuoteChatDraft(params), [params]);
  const rawTargetUserId = Number(params.get("userId"));
  const rawTargetConversationId = Number(params.get("conversationId"));
  const targetConversationId = Number.isSafeInteger(rawTargetConversationId) && rawTargetConversationId > 0
    ? rawTargetConversationId
    : null;
  const wantService = params.get("service") === "1";
  const { data: serviceUser } = trpc.chat.getServiceUser.useQuery(undefined, {
    enabled: primeProtectedChatQueries && wantService && !receptionMode,
    staleTime: 10 * 60 * 1000,
  });
  const targetUserId = !receptionMode && wantService
    ? (serviceUser?.userId ?? null)
    : !receptionMode && Number.isInteger(rawTargetUserId) && rawTargetUserId > 0
      ? rawTargetUserId
      : null;
  const inquiryKey = inquiryIntent ? buildInquiryKey(inquiryIntent) : null;

  // State
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "pinned">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [messageMenu, setMessageMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerPack, setStickerPack] = useState<"noto" | "emoji" | "yayatuan" | "business">("noto");
  const [recentStickerIds, setRecentStickerIds] = useState<ChatStickerId[]>([]);
  const recentStickers = useMemo(
    () => recentStickerIds.flatMap(id => {
      const sticker = getChatSticker(id);
      return sticker ? [sticker] : [];
    }),
    [recentStickerIds],
  );
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  /**
   * 本地乐观发送队列。消息一提交就先上屏（发送中），
   * 服务端确认后移除，失败则标记 failed 等待用户点击重试。
   */
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [sidebarSection, setSidebarSection] = useState<"all" | "unread" | "pinned">("all");
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [remarkEditor, setRemarkEditor] = useState<{
    conversationId: number;
    originalName: string;
  } | null>(null);
  const [remarkInput, setRemarkInput] = useState("");

  const [reviewTarget, setReviewTarget] = useState<{
    conversationId: number;
    otherName: string;
  } | null>(null);
  const [reviewContent, setReviewContent] = useState("");
  const [reviewImages, setReviewImages] = useState<PublicReviewImage[]>([]);
  const [reviewImageBusy, setReviewImageBusy] = useState(false);
  const [contactProfileTarget, setContactProfileTarget] = useState<ContactProfileTarget | null>(null);
  const [contactBlockState, setContactBlockState] = useState<ContactBlockState | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    message: Message;
    src: string;
    alt: string;
  } | null>(null);

  const msgListRef = useRef<HTMLDivElement>(null);
  const msgInputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewImageInputRef = useRef<HTMLInputElement>(null);
  const reviewImagesRef = useRef<PublicReviewImage[]>([]);
  const reviewImageBatchRef = useRef(0);
  const reviewRequestIdRef = useRef("");
  const localAttachmentUrlsRef = useRef(new Set<string>());
  const autoInquiryKeyRef = useRef<string | null>(null);
  const inquiryActionRef = useRef(false);
  const inquiryTransportRef = useRef<InquiryTransportFailure>(null);
  const currentUserIdRef = useRef<number | null>(user?.id ?? null);
  const currentEnterpriseIdRef = useRef<number | null>(enterpriseScopeId);
  const scopeMountedRef = useRef(false);
  const scopeGenerationRef = useRef(0);
  const selectedConversationLinkRef = useRef<string | null>(null);
  // Update during render so an in-flight request cannot send or update UI for a newly switched account/enterprise.
  currentUserIdRef.current = user?.id ?? null;
  currentEnterpriseIdRef.current = enterpriseScopeId;
  const shouldStickToBottomRef = useRef(true);
  const scrolledConversationRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    scopeMountedRef.current = true;
    scopeGenerationRef.current += 1;
    return () => {
      // Layout cleanup runs in the same commit as the new scope. A stale
      // promise/timer must not send, retry, or navigate from the retired body.
      scopeMountedRef.current = false;
      scopeGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) setLoginOpen(true);
  }, [loading, user]);

  useEffect(() => {
    // The one-shot mount guard must never survive a logout, account switch, or enterprise switch.
    autoInquiryKeyRef.current = null;
    selectedConversationLinkRef.current = null;
    setInquiryDelivery(current => current && current.userId === user?.id && current.enterpriseId === enterpriseScopeId ? current : null);
  }, [enterpriseScopeId, user?.id]);

  useEffect(() => {
    setRecentStickerIds(getRecentChatStickerIds());
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    reviewImageBatchRef.current += 1;
    reviewRequestIdRef.current = "";
    setStickerPickerOpen(false);
    setStickerPack("emoji");
    setAttachmentMenuOpen(false);
    setReplyingTo(null);
    setMessageMenu(null);
    setContactProfileTarget(null);
    setContactBlockState(null);
    setImagePreview(null);
    setReviewTarget(null);
    setReviewContent("");
    setReviewImageBusy(false);
    setReviewImages(previous => {
      previous.forEach(image => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  }, [activeConvId]);

  useEffect(() => () => {
    localAttachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    localAttachmentUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    reviewImagesRef.current = reviewImages;
  }, [reviewImages]);

  useEffect(() => () => {
    reviewImageBatchRef.current += 1;
    reviewImagesRef.current.forEach(image => URL.revokeObjectURL(image.previewUrl));
  }, []);

  useEffect(() => {
    selectedConversationLinkRef.current = null;
  }, [targetConversationId]);

  // ─── tRPC queries ───
  const convListQuery = trpc.chat.listConversations.useQuery(undefined, {
    enabled: primeProtectedChatQueries,
    refetchInterval: 5000, // 每5秒刷新
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!user || !targetConversationId || targetUserId || inquiryIntent || quoteChatDraft || wantService) return;
    const key = `${user.id}:${targetConversationId}`;
    if (selectedConversationLinkRef.current === key || convListQuery.isLoading || !convListQuery.data) return;
    // 会话列表已由服务器按当前登录者鉴权；URL不能指定列表外的私人会话。
    if (!convListQuery.data.some(conversation => Number(conversation.id) === targetConversationId)) return;
    selectedConversationLinkRef.current = key;
    setActiveConvId(targetConversationId);
  }, [user?.id, targetConversationId, targetUserId, inquiryIntent, quoteChatDraft, wantService,
    convListQuery.data, convListQuery.isLoading]);
  const navUnreadTotal = useMemo(
    () => (convListQuery.data ?? []).reduce((sum, conv) => sum + Math.max(0, conv.unreadCount ?? 0), 0),
    [convListQuery.data],
  );
  const unreadConversationCount = useMemo(
    () => (convListQuery.data ?? []).filter(conv => (conv.unreadCount ?? 0) > 0).length,
    [convListQuery.data],
  );
  useChatUnreadDocumentTitle(navUnreadTotal, Boolean(user));

  const groupsQuery = trpc.chat.listGroups.useQuery(undefined, {
    enabled: primeProtectedChatQueries,
  });
  const trashedGroupsQuery = trpc.chat.listTrashedGroups.useQuery(undefined, {
    enabled: primeProtectedChatQueries,
  });

  const messagesQuery = trpc.chat.getMessages.useQuery(
    { conversationId: activeConvId!, limit: 100 },
    { enabled: !!activeConvId && !!user, refetchInterval: 3000 }
  );

  const reviewStateQuery = trpc.publicReview.state.useQuery(
    { conversationId: activeConvId! },
    { enabled: !!activeConvId && !!user }
  );

  const utils = trpc.useUtils();

  // ─── tRPC mutations ───
  const getOrCreateConv = trpc.chat.getOrCreateConversation.useMutation();
  const sendMessageMut = trpc.chat.sendMessage.useMutation();
  const recallMessageMut = trpc.chat.recallMessage.useMutation();
  const deleteMessageForMeMut = trpc.chat.deleteMessageForMe.useMutation();
  const uploadAttachmentMut = trpc.chat.uploadAttachment.useMutation();
  const startInventoryInquiryMut = trpc.chat.startInventoryInquiry.useMutation();
  const markReadMut = trpc.chat.markRead.useMutation({
    /*
     * 会话与询价分组必须在用户看到消息时立即同步消除数字，不能等待网络往返。
     * 先取消正在进行的会话列表和总未读请求，避免旧响应覆盖本地清零；分组数字
     * 与总未读都由清零后的同一份会话列表计算，保证所有角标立即一致。
     */
    onMutate: async ({ conversationId }) => {
      await Promise.all([
        utils.chat.listConversations.cancel(),
        utils.chat.getTotalUnread.cancel(),
      ]);
      const previousConversations = utils.chat.listConversations.getData();
      const previousTotalUnread = utils.chat.getTotalUnread.getData();
      const nextConversations = previousConversations?.map(conversation =>
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation,
      );
      utils.chat.listConversations.setData(undefined, nextConversations);
      if (nextConversations) {
        utils.chat.getTotalUnread.setData(undefined, {
          total: nextConversations.reduce(
            (sum, conversation) => sum + Math.max(0, Number(conversation.unreadCount ?? 0)),
            0,
          ),
        });
      }
      return { previousConversations, previousTotalUnread };
    },
    onSuccess: result => {
      utils.chat.getTotalUnread.setData(undefined, { total: result.totalUnread });
    },
    onError: (_error, _variables, context) => {
      if (context?.previousConversations) {
        utils.chat.listConversations.setData(undefined, context.previousConversations);
      }
      if (context?.previousTotalUnread) {
        utils.chat.getTotalUnread.setData(undefined, context.previousTotalUnread);
      }
    },
    /*
     * 放在 hook 级 onSettled，而不是每次 mutate 的临时回调中：用户快速切换
     * 多个会话时，TanStack Query 会把 MutationObserver 移到最后一次调用，前面
     * 调用的临时 onSuccess 可能不再执行；hook 级回调会随每个 mutation 执行。
     */
    onSettled: () => {
      void utils.chat.listConversations.invalidate();
      void utils.chat.getTotalUnread.invalidate();
    },
  });
  const pinConvMut = trpc.chat.pinConversation.useMutation();
  const setRemarkNameMut = trpc.chat.setRemarkName.useMutation();
  const setGroupMembershipMut = trpc.chat.setGroupMembership.useMutation();
  const deleteConvMut = trpc.chat.deleteConversation.useMutation();
  const createGroupMut = trpc.chat.createGroup.useMutation();
  const dissolveGroupMut = trpc.chat.dissolveGroup.useMutation();
  const renameGroupMut = trpc.chat.renameGroup.useMutation();
  const mergeGroupsMut = trpc.chat.mergeGroups.useMutation();
  const trashGroupMut = trpc.chat.trashGroup.useMutation();
  const restoreGroupMut = trpc.chat.restoreGroup.useMutation();
  const createReviewMut = trpc.publicReview.create.useMutation();

  const refreshChatPreviewImage = useCallback(async (message: Message) => {
    const attachmentId = message.attachment?.id;
    if (!attachmentId) return null;
    try {
      const result = await utils.chat.getAttachmentUrl.fetch({ attachmentId });
      const refreshedUrl = safeChatAttachmentUrl(result.url);
      if (!refreshedUrl) return null;
      setImagePreview(current => current?.message.id === message.id
        ? {
            ...current,
            src: refreshedUrl,
            message: current.message.attachment
              ? { ...current.message, attachment: { ...current.message.attachment, url: refreshedUrl } }
              : current.message,
          }
        : current);
      return refreshedUrl;
    } catch {
      return null;
    }
  }, [utils.chat.getAttachmentUrl]);

  const openChatImagePreview = useCallback((message: Message) => {
    if (message.msgType !== "image") return;
    const src = safeChatAttachmentUrl(message.attachment?.url);
    if (!src) return;
    setImagePreview({
      message,
      src,
      alt: message.attachment?.originalName ?? "聊天图片",
    });
    // A message-list URL is normally fresh, but refresh while opening so a
    // long-lived chat tab does not rely on an expired signature.
    if (message.attachment?.id) void refreshChatPreviewImage(message);
  }, [refreshChatPreviewImage]);

  /**
   * 服务端消息 + 本地未送达消息的合并视图。
   *
   * 以 clientMessageId 为准去重：一旦服务端已返回同一条消息，
   * 就不再渲染本地副本，避免轮询刚好拿到新消息时出现重影气泡。
   */
  const mergedMessages = useMemo(() => {
    const serverMessages = (messagesQuery.data?.messages ?? []) as Message[];
    const deliveredKeys = new Set(
      serverMessages.map((m) => m.clientMessageId).filter((key): key is string => !!key),
    );
    const localOnly = pendingMessages.filter(
      (m) =>
        m.conversationId === activeConvId
        && !!m.clientMessageId
        && !deliveredKeys.has(m.clientMessageId),
    );
    return [...serverMessages, ...localOnly];
  }, [messagesQuery.data?.messages, pendingMessages, activeConvId]);

  // ─── 稳定消息顺序与滚动位置 ───
  const orderedMessages = useMemo(
    () => [...mergedMessages].sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (timeDiff) return timeDiff;
      // 本地消息 id 是 `local:xxx` 字符串，与服务端数字 id 混在一起时需分别处理
      return typeof a.id === "number" && typeof b.id === "number"
        ? a.id - b.id
        : String(a.id).localeCompare(String(b.id));
    }),
    [mergedMessages],
  );
  const latestMessageId = orderedMessages[orderedMessages.length - 1]?.id;
  const peerLastReadMessageId = Number(messagesQuery.data?.peerLastReadMessageId ?? 0);

  // 仅当聊天页可见且用户确实看到消息底部时清零未读。
  // 用户向上翻阅历史消息时，新消息必须保留数字角标，不能被后台轮询静默标记为已读。
  useEffect(() => {
    if (!activeConvId || !pageVisible || !messageListAtBottom) return;
    markReadMut.mutate(
      { conversationId: activeConvId },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, latestMessageId, pageVisible, messageListAtBottom]);

  useEffect(() => {
    const list = msgListRef.current;
    if (!list || !activeConvId) return;
    const switchedConversation = scrolledConversationRef.current !== activeConvId;
    if (switchedConversation) {
      scrolledConversationRef.current = activeConvId;
      shouldStickToBottomRef.current = true;
      setMessageListAtBottom(true);
    }
    if (!switchedConversation && !shouldStickToBottomRef.current) return;

    const frame = requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      shouldStickToBottomRef.current = true;
      setMessageListAtBottom(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeConvId, latestMessageId]);

  // ─── 过滤会话列表 ───
  const filteredConversations = useMemo(() => {
    let items = convListQuery.data ?? [];
    if (sidebarSection === "unread") items = items.filter((c) => c.unreadCount > 0);
    /*
     * 「已置顶」分区只看用户自己置顶的会话。
     * 官方客服虽然固定在顶部，但那是产品安排、不是用户操作，
     * 把它杂在这里会让用户困惑「我没置顶它为何在此」，
     * 而且界面上没有开关可以把它去掉。
     */
    if (sidebarSection === "pinned") items = items.filter((c) => c.pinned && !c.isService);
    if (filter === "unread") items = items.filter((c) => c.unreadCount > 0);
    if (filter === "pinned") items = items.filter((c) => c.pinned && !c.isService);
    if (groupFilter) items = items.filter((c) => c.groupIds.includes(groupFilter));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((c) =>
        c.otherUserName.toLowerCase().includes(q)
        || c.otherUserOriginalName.toLowerCase().includes(q),
      );
    }
    /*
     * 官方客服（51小电）固定排第一，优先于用户自己的置顶。
     *
     * 必须与后端 ORDER BY 保持同一优先级：
     * 两处排序不一致时，列表会在数据到达后发生跳动。
     */
    return [...items].sort((a, b) =>
      Number(b.isService) - Number(a.isService)
      || Number(b.pinned) - Number(a.pinned)
      || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      || b.id - a.id,
    );
  }, [convListQuery.data, sidebarSection, filter, groupFilter, searchQuery]);

  // ─── 当前活跃会话 ───
  const activeConv = useMemo(
    () => (convListQuery.data ?? []).find((c) => c.id === activeConvId),
    [convListQuery.data, activeConvId]
  );

  // 官方客服不参与商户信誉评价，相关入口全部隐藏
  const isServiceConv = !!activeConv && isServiceName(activeConv.otherUserOriginalName);
  const activeConversationBlocked = Boolean(
    contactBlockState
      && contactBlockState.conversationId === activeConvId
      && (contactBlockState.blockedByMe || contactBlockState.blockedByContact),
  );
  const reviewState = reviewStateQuery.data;

  const openActiveContactProfile = useCallback(() => {
    if (!activeConv || isServiceConv) return;
    setContactProfileTarget({
      conversationId: activeConv.id,
      contactUserId: activeConv.otherUserId,
      name: activeConv.otherUserName,
      avatarUrl: activeConv.otherUserAvatar,
      companySupplierId: activeConv.otherCompanyProfileSupplierId,
    });
  }, [activeConv, isServiceConv]);

  // ─── 实名公开评价 ───
  const closeReviewModal = () => {
    reviewImageBatchRef.current += 1;
    reviewRequestIdRef.current = "";
    setReviewTarget(null);
    setReviewContent("");
    setReviewImageBusy(false);
    setReviewImages(previous => {
      previous.forEach(image => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  };

  const handleOpenReview = () => {
    if (!activeConv || isServiceConv) return;
    if (!reviewState) {
      toast.error(reviewStateQuery.isError ? "评论信息加载失败" : "评论信息加载中");
      return;
    }
    if (!reviewState.available) {
      const unavailableMessage = reviewState.reason === "company_required"
        ? "请先完成企业认证"
        : reviewState.reason === "target_unavailable"
          ? "对方未完成企业认证"
          : "官方客服不能评论";
      toast.error(unavailableMessage);
      return;
    }
    reviewImageBatchRef.current += 1;
    reviewRequestIdRef.current = createPublicReviewRequestId();
    setReviewContent("");
    setReviewImages(previous => {
      previous.forEach(image => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setReviewTarget({
      conversationId: activeConv.id,
      otherName: activeConv.otherUserName,
    });
  };

  const handleReviewImageInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !reviewTarget) return;
    const remaining = PUBLIC_REVIEW_IMAGE_LIMIT - reviewImages.length;
    if (remaining <= 0) {
      toast.error(`最多上传${PUBLIC_REVIEW_IMAGE_LIMIT}张图片`);
      return;
    }
    const batch = reviewImageBatchRef.current;
    setReviewImageBusy(true);
    const created: PublicReviewImage[] = [];
    try {
      for (const file of files.slice(0, remaining)) {
        created.push(await createPublicReviewImage(file));
        if (batch !== reviewImageBatchRef.current) {
          created.forEach(image => URL.revokeObjectURL(image.previewUrl));
          return;
        }
      }
      setReviewImages(previous => [...previous, ...created]);
      if (files.length > remaining) toast.info(`最多保留${PUBLIC_REVIEW_IMAGE_LIMIT}张图片`);
    } catch (error) {
      created.forEach(image => URL.revokeObjectURL(image.previewUrl));
      if (batch === reviewImageBatchRef.current) {
        toast.error(error instanceof Error ? error.message : "图片处理失败");
      }
    } finally {
      if (batch === reviewImageBatchRef.current) setReviewImageBusy(false);
    }
  };

  const removeReviewImage = (previewUrl: string) => {
    URL.revokeObjectURL(previewUrl);
    setReviewImages(previous => previous.filter(image => image.previewUrl !== previewUrl));
  };

  const handleSubmitReview = () => {
    if (!reviewTarget) return;
    const content = reviewContent.trim();
    if (content.length < 2) {
      toast.error("请填写至少2个字的评论内容");
      return;
    }
    const requestId = reviewRequestIdRef.current || createPublicReviewRequestId();
    reviewRequestIdRef.current = requestId;
    const onSuccess = () => {
      const conversationId = reviewTarget.conversationId;
      closeReviewModal();
      void utils.publicReview.state.invalidate({ conversationId });
      void utils.publicReview.list.invalidate();
      toast.success("评论已公开");
    };
    const onError = (error: { message: string }) => toast.error(error.message);
    createReviewMut.mutate({
      conversationId: reviewTarget.conversationId,
      requestId,
      content,
      images: reviewImages.map(image => ({ base64: image.base64 })),
    }, { onSuccess, onError });
  };

  /**
   * 统一发送入口（文本与报价共用）。
   *
   * 先把消息以“发送中”状态放进本地队列立即上屏，再调接口：
   * - 成功：把服务端返回的真实消息写入缓存并移除本地副本
   * - 失败：标记 failed，气泡下方出现“发送失败，点击重试”
   *
   * 重试时复用同一个 clientMessageId，服务端据此幂等去重，
   * 因此“已发成功但响应丢失”的重试不会产生重复消息。
   */
  const submitMessage = useCallback(
    (payload: {
      conversationId: number;
      clientMessageId: string;
      msgType: "text" | "quote" | "sticker" | "image" | "file";
      content: string;
      replyToMessageId?: number;
      replyTo?: Message["replyTo"];
      createdAt?: Date;
      attachment?: ChatAttachment | null;
      localFile?: File;
      uploadState?: "uploading" | "sending";
    }) => {
      if (!user) return;
      if (
        contactBlockState?.conversationId === payload.conversationId
        && (contactBlockState.blockedByMe || contactBlockState.blockedByContact)
      ) {
        toast.error("该会话已被屏蔽，不能发送消息");
        return;
      }
      const localMessage: Message = {
        id: `local:${payload.clientMessageId}`,
        conversationId: payload.conversationId,
        senderId: user.id,
        clientMessageId: payload.clientMessageId,
        msgType: payload.msgType,
        content: payload.content,
        replyToMessageId: payload.replyToMessageId ?? null,
        replyTo: payload.replyTo ?? null,
        createdAt: payload.createdAt ?? new Date(),
        attachment: payload.attachment,
        localFile: payload.localFile,
        uploadState: payload.uploadState,
        deliveryState: "sending",
      };
      setPendingMessages((prev) =>
        prev.some((m) => m.clientMessageId === payload.clientMessageId)
          ? prev.map((m) =>
              m.clientMessageId === payload.clientMessageId
                ? {
                    ...m,
                    content: payload.content,
                    replyToMessageId: payload.replyToMessageId ?? null,
                    replyTo: payload.replyTo ?? null,
                    attachment: payload.attachment ?? m.attachment,
                    localFile: payload.localFile ?? m.localFile,
                    uploadState: payload.uploadState ?? "sending",
                    deliveryState: "sending" as const,
                  }
                : m,
            )
          : [...prev, localMessage],
      );
      shouldStickToBottomRef.current = true;
      setMessageListAtBottom(true);

      sendMessageMut.mutate(
        {
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
          msgType: payload.msgType,
          content: payload.content,
          replyToMessageId: payload.replyToMessageId,
        },
        {
          onSuccess: (result) => {
            const storedRaw = result?.message as Message | undefined;
            const stored = storedRaw && payload.attachment
              ? { ...storedRaw, attachment: payload.attachment }
              : storedRaw;
            if (stored) {
              utils.chat.getMessages.setData(
                { conversationId: payload.conversationId, limit: 100 },
                (prev) => {
                  const existing = prev?.messages ?? [];
                  if (existing.some((m) => m.id === stored.id)) return prev;
                  return {
                    messages: [...existing, stored],
                    nextCursor: prev?.nextCursor,
                    peerLastReadMessageId: prev?.peerLastReadMessageId ?? 0,
                  } as typeof prev;
                },
              );
            }
            setPendingMessages((prev) => {
              const pending = prev.find((m) => m.clientMessageId === payload.clientMessageId);
              const localUrl = pending?.attachment?.url;
              if (localUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(localUrl);
                localAttachmentUrlsRef.current.delete(localUrl);
              }
              return prev.filter((m) => m.clientMessageId !== payload.clientMessageId);
            });
            void utils.chat.getMessages.invalidate({
              conversationId: payload.conversationId,
              limit: 100,
            });
            void utils.chat.listConversations.invalidate();
            void utils.publicReview.state.invalidate({
              conversationId: payload.conversationId,
            });
          },
          onError: () => {
            setPendingMessages((prev) =>
              prev.map((m) =>
                m.clientMessageId === payload.clientMessageId
                  ? { ...m, uploadState: undefined, deliveryState: "failed" as const }
                  : m,
              ),
            );
            toast.error("消息发送失败，请点击消息下方重试");
          },
        },
      );
    },
    [user, contactBlockState, sendMessageMut, utils],
  );

  /** 按 inventoryId 由服务端解析当前负责人、建会话并原子写入询价卡片。 */
  const submitInventoryInquiry = useCallback(
    async (payload: {
      clientMessageId: string;
      qty: number | null;
      inventoryId: number;
      source?: "search" | "detail" | "recommend" | "quote" | "data_hub" | "company";
      initiatorUserId: number;
      initiatorEnterpriseId: number;
      inquiryProtocol: "buyer-bound-v3";
    }) => {
      const generation = scopeGenerationRef.current;
      if (!scopeMountedRef.current) return null;
      if (receptionMode) {
        toast.error(businessReception?.personalFlowMessages["chat.startInventoryInquiry"] ?? "企业接待不能代替买方创建询价。");
        return null;
      }
      if (!user || currentUserIdRef.current !== payload.initiatorUserId) {
        inquiryTransportRef.current = "account_changed";
        return null;
      }
      if (currentEnterpriseIdRef.current !== payload.initiatorEnterpriseId) {
        inquiryTransportRef.current = "enterprise_changed";
        return null;
      }
      shouldStickToBottomRef.current = true;
      setMessageListAtBottom(true);
      try {
        const result = await startInventoryInquiryMut.mutateAsync(payload);
        // A response from the prior account or enterprise must not select a conversation in the new scope.
        if (!scopeMountedRef.current || generation !== scopeGenerationRef.current) return null;
        if (currentUserIdRef.current !== payload.initiatorUserId) {
          inquiryTransportRef.current = "account_changed";
          return null;
        }
        if (currentEnterpriseIdRef.current !== payload.initiatorEnterpriseId) {
          inquiryTransportRef.current = "enterprise_changed";
          return null;
        }
        setActiveConvId(result.conversationId);
        /*
         * 发送成功与缓存刷新必须分开判断：接口已落库后，即使后续刷新因瞬时网络
         * 波动失败，也不能误提示“询价发送失败”。轮询会在下一次自动拉回消息。
         */
        void Promise.allSettled([
          utils.chat.getMessages.invalidate({
            conversationId: result.conversationId,
            limit: 100,
          }),
          utils.chat.listConversations.invalidate(),
          utils.chat.listGroups.invalidate(),
        ]);
        return result.conversationId;
      } catch (error) {
        inquiryTransportRef.current = inventoryInquiryTransportFailure(error);
        console.error("[ChatPage] 询价卡片发送失败", error);
        return null;
      }
    },
    [businessReception, receptionMode, startInventoryInquiryMut, user, utils],
  );

  /**
   * Always read the buyer-scoped server status before a send. A source-click claim is
   * the only path allowed to set forceSend on mount; the same method powers all card actions.
   */
  const checkInquiryDelivery = useCallback(async (forceSend = false, forcedId?: string) => {
    if (receptionMode) return;
    if (!scopeMountedRef.current || !user || !inquiryIntent || !enterpriseScopeId || inquiryActionRef.current) return;
    const generation = scopeGenerationRef.current;
    const buyerUserId = user.id;
    const buyerEnterpriseId = enterpriseScopeId;
    const clientMessageId = forcedId ?? inquiryIntent.clientMessageId;
    if (!clientMessageId) {
      setInquiryDelivery({
        phase: "unavailable",
        inventoryId: inquiryIntent.inventoryId,
        userId: buyerUserId,
        enterpriseId: buyerEnterpriseId,
        key: "",
      });
      return;
    }

    const input = { inventoryId: inquiryIntent.inventoryId, clientMessageId };
    const base = { inventoryId: inquiryIntent.inventoryId, userId: buyerUserId, enterpriseId: buyerEnterpriseId, key: clientMessageId };
    const isCurrentBuyer = () => scopeMountedRef.current
      && generation === scopeGenerationRef.current
      && currentUserIdRef.current === buyerUserId
      && currentEnterpriseIdRef.current === buyerEnterpriseId;
    const setForCurrentBuyer = (next: Omit<InquiryDeliveryState, "inventoryId" | "userId" | "enterpriseId" | "key">) => {
      if (isCurrentBuyer()) setInquiryDelivery({ ...base, ...next });
    };
    const readStatus = async () => {
      if (!isCurrentBuyer()) throw new Error("询价企业作用域已退出");
      // `fetch` may otherwise return a cached success after an ambiguous transport failure.
      await utils.chat.getInventoryInquiryStatus.invalidate(input);
      if (!isCurrentBuyer()) throw new Error("询价企业作用域已退出");
      return utils.chat.getInventoryInquiryStatus.fetch(input);
    };
    const openSentConversation = (conversationId: number) => {
      if (!isCurrentBuyer()) return;
      setActiveConvId(conversationId);
      void utils.chat.listConversations.invalidate();
    };

    inquiryActionRef.current = true;
    setForCurrentBuyer({ phase: "checking" });
    try {
      let status;
      try {
        status = await readStatus();
      } catch (error) {
        setForCurrentBuyer({
          phase: inventoryInquiryTransportFailure(error) === "unauthorized" ? "login" : "unavailable",
        });
        return;
      }
      if (!isCurrentBuyer()) return;

      const existingConversationId = inquiryConversationId(status);
      if (existingConversationId) {
        openSentConversation(existingConversationId);
        setForCurrentBuyer({ phase: "sent", conversationId: existingConversationId });
        return;
      }
      if (status.status !== "unsent") {
        setForCurrentBuyer({ phase: "pending" });
        return;
      }
      if (!forceSend) {
        setForCurrentBuyer({ phase: "unsent" });
        return;
      }

      const sendOnce = async () => {
        if (!isCurrentBuyer()) {
          inquiryTransportRef.current = currentUserIdRef.current === buyerUserId ? "enterprise_changed" : "account_changed";
          return null;
        }
        inquiryTransportRef.current = null;
        // Persist before every mutation: a reload after an ambiguous request may only recheck.
        try {
          localStorage.setItem(`dianzi51-inquiry-attempt:${buyerUserId}:${buyerEnterpriseId}:${clientMessageId}`, String(Date.now()));
        } catch {
          // The source claim requires storage; explicit manual sending still remains available.
        }
        return submitInventoryInquiry({
          clientMessageId,
          qty: inquiryIntent.qty,
          inventoryId: inquiryIntent.inventoryId,
          source: inquiryIntent.source,
          initiatorUserId: user.id,
          initiatorEnterpriseId: buyerEnterpriseId,
          inquiryProtocol: "buyer-bound-v3",
        });
      };
      const finishSent = (conversationId: number) => {
        if (!isCurrentBuyer()) return;
        openSentConversation(conversationId);
        setInquiryDelivery(null);
        navigate("/chat", { replace: true });
      };

      const sent = await sendOnce();
      if (!isCurrentBuyer()) return;
      if (sent) {
        finishSent(sent);
        return;
      }
      if (inquiryTransportRef.current === "unauthorized") {
        setForCurrentBuyer({ phase: "login" });
        return;
      }
      if (inquiryTransportRef.current !== "retryable") {
        // Permanent validation failures and account changes must never be retried automatically.
        setForCurrentBuyer({ phase: "pending" });
        return;
      }

      for (const delay of INVENTORY_INQUIRY_RETRY_DELAYS_MS) {
        await new Promise<void>(resolve => window.setTimeout(resolve, delay));
        if (!isCurrentBuyer()) return;

        let retryStatus;
        try {
          // Each additional mutation is preceded by a fresh read-only status query.
          retryStatus = await readStatus();
        } catch (error) {
          setForCurrentBuyer({
            phase: inventoryInquiryTransportFailure(error) === "unauthorized" ? "login" : "unavailable",
          });
          return;
        }
        if (!isCurrentBuyer()) return;

        const sentConversationId = inquiryConversationId(retryStatus);
        if (sentConversationId) {
          finishSent(sentConversationId);
          return;
        }
        if (retryStatus.status !== "unsent") {
          setForCurrentBuyer({ phase: "pending" });
          return;
        }

        const retrySent = await sendOnce();
        if (!isCurrentBuyer()) return;
        if (retrySent) {
          finishSent(retrySent);
          return;
        }
        if ((inquiryTransportRef.current as InquiryTransportFailure) === "unauthorized") {
          setForCurrentBuyer({ phase: "login" });
          return;
        }
        if (inquiryTransportRef.current !== "retryable") {
          setForCurrentBuyer({ phase: "pending" });
          return;
        }
      }

      // The final ambiguous request is intentionally not followed by another automatic send.
      setForCurrentBuyer({ phase: "pending" });
    } finally {
      inquiryActionRef.current = false;
    }
  }, [enterpriseScopeId, inquiryIntent, navigate, receptionMode, submitInventoryInquiry, user, utils]);

  // ─── 初始化：先核对投递状态；仅来源页同买家的一次性新点击可在核对后自动发送 ───
  useEffect(() => {
    if (!user) return;

    // The backend page never requests personal service/private/buyer flows.
    // Reception-safe conversation links still use the normal scoped list path.
    if (receptionMode) {
      autoInquiryKeyRef.current = null;
      setInquiryDelivery(null);
      return;
    }

    if (!inquiryIntent) {
      autoInquiryKeyRef.current = null;
      setInquiryDelivery(null);
      if (!targetUserId || targetUserId === user.id) return;
      const generation = scopeGenerationRef.current;
      void (async () => {
        try {
          const data = await getOrCreateConv.mutateAsync({ otherUserId: targetUserId });
          if (!scopeMountedRef.current || generation !== scopeGenerationRef.current || currentUserIdRef.current !== user.id) return;
          setActiveConvId(data.conversationId);
          if (quoteChatDraft) setMsgInput(current => current.trim() ? current : quoteChatDraft);
          void utils.chat.listConversations.invalidate();
        } catch (error) {
          console.error("[ChatPage] 会话初始化失败", error);
        }
      })();
      return;
    }

    if (!enterpriseScopeId) return;
    // The guard is stable per URL, account, and enterprise; a later company switch
    // must not consume or retry the former buyer's one-shot intent.
    const scopedInquiryKey = `${user.id}:${enterpriseScopeId}:${inquiryKey ?? ""}`;
    if (autoInquiryKeyRef.current === scopedInquiryKey) return;
    autoInquiryKeyRef.current = scopedInquiryKey;

    void (async () => {
      /*
       * New links already carry the source-created key. Legacy links receive a compatible key
       * once and immediately write it into the URL, so any manual attempt/recheck stays stable.
       */
      const inquiryMsgId = inquiryIntent.clientMessageId ?? createClientMessageId("inq");
      if (!inquiryIntent.clientMessageId) {
        const url = new URL(window.location.href);
        url.searchParams.set("inquiryId", inquiryMsgId);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }

      let freshSourceClaim = false;
      if (params.get("inquiryAuto") === "1" && inquiryIntent.inquiryEnterpriseId === enterpriseScopeId) {
        const claimKey = `dianzi51-inquiry-intent:${inquiryMsgId}`;
        try {
          const rawClaim = localStorage.getItem(claimKey);
          freshSourceClaim = isFreshInventoryInquiryClaim(
            rawClaim ? JSON.parse(rawClaim) : null,
            user.id,
            inquiryIntent.inventoryId,
            enterpriseScopeId,
          );
        } catch {
          freshSourceClaim = false;
        } finally {
          // Consume before the status check/send, including stale, malformed, cross-account, and cross-enterprise claims.
          try {
            localStorage.removeItem(claimKey);
          } catch {
            // Storage failure simply leaves this link manual-only.
          }
        }
      }

      // Storage failure is deliberately treated as already attempted: never auto-send without a durable guard.
      let attempted = true;
      try {
        attempted = Boolean(localStorage.getItem(`dianzi51-inquiry-attempt:${user.id}:${enterpriseScopeId}:${inquiryMsgId}`));
      } catch {
        // Keep the safe default.
      }
      await checkInquiryDelivery(freshSourceClaim && !attempted, inquiryMsgId);
    })();
    // The guard above intentionally owns this one mount/URL initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterpriseScopeId, user, targetUserId, inquiryKey, quoteChatDraft, receptionMode]);

  const uploadAndSendAttachment = useCallback(async (
    file: File,
    kind: "image" | "file",
    existingClientMessageId?: string,
    existingReplyTo?: Message["replyTo"],
  ) => {
    if (!user || !activeConvId || attachmentBusy) return;
    if (activeConversationBlocked) {
      toast.error("该会话已被屏蔽，不能发送附件");
      return;
    }
    const extension = fileExtension(file.name);
    const mimeType = kind === "image"
      ? file.type
      : (CHAT_FILE_MIME_BY_EXTENSION[extension] ?? file.type);
    const validImage = kind === "image"
      && CHAT_IMAGE_MIMES.includes(mimeType as (typeof CHAT_IMAGE_MIMES)[number])
      && file.size <= MAX_CHAT_IMAGE_BYTES;
    const validFile = kind === "file"
      && CHAT_FILE_EXTENSIONS.includes(extension as (typeof CHAT_FILE_EXTENSIONS)[number])
      && Boolean(CHAT_FILE_MIME_BY_EXTENSION[extension])
      && file.size <= MAX_CHAT_FILE_BYTES;
    if (!file.size || !(validImage || validFile)) {
      toast.error(kind === "image"
        ? "仅支持 10MB 以内的 JPG、PNG、WebP 图片"
        : "仅支持 20MB 以内的 PDF、Word、Excel、CSV、TXT 文件");
      return;
    }

    const replyTo = existingClientMessageId
      ? existingReplyTo ?? null
      : messageReplyDescriptor(replyingTo);
    const replyToMessageId = replyTo?.id;
    if (!existingClientMessageId && replyTo) setReplyingTo(null);
    const clientMessageId = existingClientMessageId ?? createClientMessageId(kind);
    let previewUrl: string | null = null;
    if (kind === "image") {
      previewUrl = URL.createObjectURL(file);
      localAttachmentUrlsRef.current.add(previewUrl);
    }
    const localAttachment: ChatAttachment = {
      kind,
      originalName: file.name,
      mimeType,
      byteSize: file.size,
      url: previewUrl,
    };
    setPendingMessages((prev) => {
      const exists = prev.some((message) => message.clientMessageId === clientMessageId);
      const local: Message = {
        id: `local:${clientMessageId}`,
        conversationId: activeConvId,
        senderId: user.id,
        clientMessageId,
        msgType: kind,
        content: file.name,
        replyToMessageId,
        replyTo,
        createdAt: new Date(),
        attachment: localAttachment,
        localFile: file,
        uploadState: "uploading",
        deliveryState: "sending",
      };
      return exists
        ? prev.map((message) => {
            if (message.clientMessageId !== clientMessageId) return message;
            const oldUrl = message.attachment?.url;
            if (oldUrl?.startsWith("blob:") && oldUrl !== previewUrl) {
              URL.revokeObjectURL(oldUrl);
              localAttachmentUrlsRef.current.delete(oldUrl);
            }
            return { ...message, attachment: localAttachment, localFile: file, uploadState: "uploading", deliveryState: "sending" };
          })
        : [...prev, local];
    });
    shouldStickToBottomRef.current = true;
    setMessageListAtBottom(true);
    setAttachmentBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const uploaded = await uploadAttachmentMut.mutateAsync({
        conversationId: activeConvId,
        kind,
        fileName: file.name,
        mimeType,
        base64,
      });
      const content = JSON.stringify({ attachmentId: uploaded.attachmentId });
      submitMessage({
        conversationId: activeConvId,
        clientMessageId,
        msgType: kind,
              content,
              replyToMessageId,
              replyTo,
              localFile: file,
        uploadState: "sending",
        attachment: {
          id: uploaded.attachmentId,
          kind: uploaded.kind,
          originalName: uploaded.originalName,
          mimeType: uploaded.mimeType,
          byteSize: uploaded.byteSize,
          url: uploaded.url,
        },
      });
    } catch (error) {
      setPendingMessages((prev) => prev.map((message) =>
        message.clientMessageId === clientMessageId
          ? { ...message, uploadState: undefined, deliveryState: "failed" }
          : message,
      ));
      toast.error(error instanceof Error ? error.message : "附件上传失败，请点击重试");
    } finally {
      setAttachmentBusy(false);
    }
  }, [activeConvId, activeConversationBlocked, attachmentBusy, replyingTo, uploadAttachmentMut, submitMessage, user]);

  /** 点击“发送失败，点击重试”：原参数原 clientMessageId 重放 */
  const handleRetryMessage = useCallback(
    (msg: Message) => {
      if (!msg.clientMessageId) return;
      if ((msg.msgType === "image" || msg.msgType === "file") && msg.localFile) {
        let attachmentId = 0;
        try {
          attachmentId = Number((JSON.parse(msg.content) as { attachmentId?: unknown }).attachmentId);
        } catch {
          attachmentId = 0;
        }
        if (Number.isInteger(attachmentId) && attachmentId > 0) {
          submitMessage({
            conversationId: msg.conversationId,
            clientMessageId: msg.clientMessageId,
            msgType: msg.msgType,
            content: msg.content,
            replyToMessageId: msg.replyToMessageId ?? undefined,
            replyTo: msg.replyTo,
            attachment: msg.attachment,
            localFile: msg.localFile,
            uploadState: "sending",
            createdAt: new Date(msg.createdAt),
          });
        } else {
          if (msg.replyTo) {
            void uploadAndSendAttachment(msg.localFile, msg.msgType, msg.clientMessageId, msg.replyTo);
          } else {
            void uploadAndSendAttachment(msg.localFile, msg.msgType, msg.clientMessageId);
          }
        }
        return;
      }
      if (msg.msgType !== "text" && msg.msgType !== "quote" && msg.msgType !== "sticker") return;
      submitMessage({
        conversationId: msg.conversationId,
        clientMessageId: msg.clientMessageId,
        msgType: msg.msgType,
        content: msg.content,
        replyToMessageId: msg.replyToMessageId ?? undefined,
        replyTo: msg.replyTo,
        createdAt: new Date(msg.createdAt),
      });
    },
    [submitMessage, uploadAndSendAttachment],
  );

  // ─── 发送消息 ───
  const handleSend = useCallback(() => {
    const content = msgInput.trim();
    if (!content || !activeConvId) return;
    const replyTo = messageReplyDescriptor(replyingTo);
    setMsgInput("");
    setReplyingTo(null);
    submitMessage({
      conversationId: activeConvId,
      clientMessageId: createClientMessageId("chat"),
      msgType: "text",
      content,
      replyToMessageId: replyTo?.id,
      replyTo,
    });
  }, [msgInput, activeConvId, replyingTo, submitMessage]);

  const handleSendSticker = useCallback((stickerId: ChatStickerId) => {
    if (!activeConvId) return;
    const replyTo = messageReplyDescriptor(replyingTo);
    setStickerPickerOpen(false);
    setReplyingTo(null);
    setRecentStickerIds(recordRecentChatSticker(stickerId));
    submitMessage({
      conversationId: activeConvId,
      clientMessageId: createClientMessageId("sticker"),
      msgType: "sticker",
      content: stickerId,
      replyToMessageId: replyTo?.id,
      replyTo,
    });
  }, [activeConvId, replyingTo, submitMessage]);

  const closeComposerPanels = useCallback(() => {
    setStickerPickerOpen(false);
    setAttachmentMenuOpen(false);
  }, []);

  const handleImageInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadAndSendAttachment(file, "image");
  }, [uploadAndSendAttachment]);

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadAndSendAttachment(file, "file");
  }, [uploadAndSendAttachment]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openMessageMenu = useCallback((message: Message, x: number, y: number) => {
    if (typeof message.id !== "number") return;
    const menuWidth = 148;
    const menuHeight = 164;
    setMessageMenu({
      message,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }, []);

  const handleQuoteMessage = useCallback((message: Message) => {
    if (typeof message.id !== "number" || message.recalledAt) return;
    setReplyingTo(message);
    setMessageMenu(null);
    requestAnimationFrame(() => msgInputRef.current?.focus());
  }, []);

  const handleCopyMessage = useCallback(async (message: Message) => {
    const text = messageActionText(message).trim();
    if (!text) {
      toast.error("该消息没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请重试");
    } finally {
      setMessageMenu(null);
    }
  }, []);

  const handleDeleteMessageForMe = useCallback((message: Message) => {
    if (typeof message.id !== "number") return;
    const messageId = message.id;
    const conversationId = message.conversationId;
    deleteMessageForMeMut.mutate(
      { messageId },
      {
        onSuccess: () => {
          utils.chat.getMessages.setData(
            { conversationId, limit: 100 },
            previous => previous
              ? { ...previous, messages: previous.messages.filter(item => item.id !== messageId) }
              : previous,
          );
          if (replyingTo?.id === messageId) setReplyingTo(null);
          void utils.chat.listConversations.invalidate();
          void utils.chat.getTotalUnread.invalidate();
          toast.success("已从你的聊天中删除");
        },
        onError: error => toast.error(error.message || "删除失败，请稍后重试"),
      },
    );
    setMessageMenu(null);
  }, [deleteMessageForMeMut, replyingTo?.id, utils]);

  const handleRecallMessage = useCallback((message: Message) => {
    if (typeof message.id !== "number") return;
    const messageId = message.id;
    const conversationId = message.conversationId;
    recallMessageMut.mutate(
      { messageId },
      {
        onSuccess: result => {
          utils.chat.getMessages.setData(
            { conversationId, limit: 100 },
            previous => previous
              ? {
                  ...previous,
                  messages: previous.messages.map(item => {
                    if (item.id === messageId) {
                      return {
                        ...item,
                        content: "",
                        replyToMessageId: null,
                        replyTo: null,
                        recalledAt: result.recalledAt,
                        recalledByUserId: user?.id ?? null,
                      };
                    }
                    if (item.replyToMessageId === messageId && item.replyTo) {
                      return {
                        ...item,
                        replyTo: { ...item.replyTo, content: null, unavailable: true },
                      };
                    }
                    return item;
                  }),
                }
              : previous,
          );
          if (replyingTo?.id === messageId) setReplyingTo(null);
          void utils.chat.getMessages.invalidate({ conversationId, limit: 100 });
          void utils.chat.listConversations.invalidate();
          void utils.publicReview.state.invalidate({ conversationId });
          toast.success("消息已撤回");
        },
        onError: error => toast.error(error.message || "撤回失败，请稍后重试"),
      },
    );
    setMessageMenu(null);
  }, [recallMessageMut, replyingTo?.id, user?.id, utils]);

  // ─── 会话更多操作 ───
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; convId: number } | null>(null);

  const handlePinConversation = (conversationId: number) => {
    const conversation = (convListQuery.data ?? []).find((item) => item.id === conversationId);
    if (!conversation) return;
    const nextPinned = !conversation.pinned;
    pinConvMut.mutate(
      { conversationId, pinned: nextPinned },
      {
        onSuccess: () => {
          void utils.chat.listConversations.invalidate();
          toast.success(nextPinned ? "会话已置顶" : "已取消置顶");
        },
        onError: () => toast.error("置顶操作失败，请稍后重试"),
      },
    );
    setCtxMenu(null);
  };

  const openRemarkEditor = (conversationId: number) => {
    const conversation = (convListQuery.data ?? []).find((item) => item.id === conversationId);
    if (!conversation) return;
    setRemarkEditor({
      conversationId,
      originalName: conversation.otherUserOriginalName,
    });
    setRemarkInput(conversation.remarkName ?? "");
    setCtxMenu(null);
  };

  const handleSaveRemark = () => {
    if (!remarkEditor) return;
    const remarkName = remarkInput.trim() || null;
    setRemarkNameMut.mutate(
      { conversationId: remarkEditor.conversationId, remarkName },
      {
        onSuccess: () => {
          void utils.chat.listConversations.invalidate();
          toast.success(remarkName ? "备注名已更新" : "备注名已清除");
          setRemarkEditor(null);
          setRemarkInput("");
        },
        onError: () => toast.error("备注名保存失败，请稍后重试"),
      },
    );
  };

  const handleContextMenu = (e: React.MouseEvent, convId: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, convId });
  };

  /**
   * 分组操作菜单（悬停时出现的…按钮）当前展开的分组名。
   *
   * 声明必须在下方全局点击监听之前：虽然它只在回调里被调用（运行时
   * 已初始化完成），但写成「使用先于声明」一旦被移出回调就会直接报 TDZ 错误。
   */
  const [groupMenuOpen, setGroupMenuOpen] = useState<number | null>(null);

  useEffect(() => {
    // 分组操作菜单与会话右键菜单一并关闭；
    // 漏了分组菜单会让它在点到其他地方后仍悬在侧栏上。
    const close = () => {
      setCtxMenu(null);
      setMessageMenu(null);
      setGroupMenuOpen(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ─── 新建分组弹窗 ───
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // ─── 分组改名 / 解散 ───
  /** 正在改名的分组（null 为未打开） */
  const [groupRenaming, setGroupRenaming] = useState<{ groupId: number; oldName: string } | null>(null);
  const [groupRenameInput, setGroupRenameInput] = useState("");
  /** 待确认解散的分组，memberCount 用于在确认文案里说清影响范围 */
  const [groupDissolving, setGroupDissolving] = useState<{
    groupId: number;
    groupName: string;
    memberCount: number;
  } | null>(null);
  const [groupMerging, setGroupMerging] = useState<{
    groupId: number;
    groupName: string;
    memberCount: number;
  } | null>(null);
  const [mergeTargetGroupId, setMergeTargetGroupId] = useState<number | null>(null);
  const [groupTrashing, setGroupTrashing] = useState<{
    groupId: number;
    groupName: string;
    memberCount: number;
  } | null>(null);
  const [showGroupTrash, setShowGroupTrash] = useState(false);
  /** 拖拽中的会话 ID；非 null 时分组项会高亮为可放置状态 */
  const [draggingConvId, setDraggingConvId] = useState<number | null>(null);
  /** 当前拖拽悬停在哪个分组上 */
  const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);
  /** 空分组是否已展开（默认折叠） */
  const [showEmptyGroups, setShowEmptyGroups] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteForm, setQuoteForm] = useState({ partNumber: "", brand: "", qty: "", unit: "颗", price: "" });

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    createGroupMut.mutate(
      { groupName: newGroupName.trim() },
      {
        onSuccess: () => {
          setShowGroupModal(false);
          setNewGroupName("");
          utils.chat.listGroups.invalidate();
        },
      }
    );
  };

  /** 分组使用稳定 ID；改名不会改变成员关系或型号自动归类规则。 */
  const handleRenameGroup = () => {
    if (!groupRenaming) return;
    const newName = groupRenameInput.trim();
    if (!newName) {
      toast.error("分组名不能为空");
      return;
    }
    if (newName === groupRenaming.oldName) {
      setGroupRenaming(null);
      setGroupRenameInput("");
      return;
    }
    renameGroupMut.mutate(
      { groupId: groupRenaming.groupId, newName },
      {
        onSuccess: () => {
          setGroupRenaming(null);
          setGroupRenameInput("");
          void utils.chat.listGroups.invalidate();
          toast.success("分组名已更新");
        },
        onError: (err) => {
          toast.error(err.message || "改名失败，请稍后重试");
        },
      },
    );
  };

  /** 确认解散分组。只解除归类，不影响会话与聊天记录。 */
  const handleDissolveGroup = () => {
    if (!groupDissolving) return;
    const { groupId } = groupDissolving;
    dissolveGroupMut.mutate(
      { groupId },
      {
        onSuccess: () => {
          setGroupFilter(prev => (prev === groupId ? null : prev));
          setGroupDissolving(null);
          void utils.chat.listGroups.invalidate();
          void utils.chat.listConversations.invalidate();
          toast.success("分组已解散，会话与聊天记录均保留");
        },
        onError: () => toast.error("解散失败，请稍后重试"),
      },
    );
  };

  const handleMergeGroup = () => {
    if (!groupMerging || !mergeTargetGroupId) return;
    const sourceGroupId = groupMerging.groupId;
    mergeGroupsMut.mutate(
      { sourceGroupId, targetGroupId: mergeTargetGroupId },
      {
        onSuccess: () => {
          setGroupFilter(prev => (prev === sourceGroupId ? mergeTargetGroupId : prev));
          setGroupMerging(null);
          setMergeTargetGroupId(null);
          void utils.chat.listGroups.invalidate();
          void utils.chat.listConversations.invalidate();
          toast.success("分组已合并，重复供应商已自动去重");
        },
        onError: () => toast.error("合并失败，请稍后重试", {
          description: "原分组和聊天记录均未改变",
        }),
      },
    );
  };

  const handleTrashGroup = () => {
    if (!groupTrashing) return;
    const groupId = groupTrashing.groupId;
    trashGroupMut.mutate(
      { groupId },
      {
        onSuccess: () => {
          setGroupFilter(prev => (prev === groupId ? null : prev));
          setGroupTrashing(null);
          void utils.chat.listGroups.invalidate();
          void utils.chat.listTrashedGroups.invalidate();
          toast.success("分组已删除，可在30天内恢复");
        },
        onError: error => toast.error(error.message || "删除失败，请稍后重试"),
      },
    );
  };

  const handleRestoreGroup = (groupId: number) => {
    restoreGroupMut.mutate(
      { groupId },
      {
        onSuccess: () => {
          void utils.chat.listGroups.invalidate();
          void utils.chat.listTrashedGroups.invalidate();
          toast.success("分组已恢复");
        },
        onError: error => toast.error(error.message || "恢复失败，请稍后重试"),
      },
    );
  };

  /** 拖拽会话到分组只增加一条成员关系，不覆盖其他型号分组。 */
  const handleDropOnGroup = (groupId: number, groupName: string) => {
    const convId = draggingConvId;
    setDraggingConvId(null);
    setDragOverGroup(null);
    if (!convId) return;
    setGroupMembershipMut.mutate(
      { conversationId: convId, groupId, included: true },
      {
        onSuccess: () => {
          void utils.chat.listConversations.invalidate();
          void utils.chat.listGroups.invalidate();
          toast.success(`已加入「${groupName}」`);
        },
        onError: () => toast.error("移入分组失败，请稍后重试"),
      },
    );
  };

  // ─── 分组数据 ───
  const groups = groupsQuery.data ?? [];
  const trashedGroups = trashedGroupsQuery.data ?? [];
  const activeGroup = groups.find(group => group.id === groupFilter) ?? null;

  /*
   * 必须放在 loading / !user 条件返回之前。
   *
   * useAuth 首次渲染通常处于 loading=true，登录态确认后才变为 user 有值。
   * 如果这个 useMemo 位于条件返回之后，同一 ChatPage 前后两次渲染会执行不同
   * 数量的 Hook，React 会直接抛出 Hook 顺序异常并进入路由错误页。
   */
  const groupStats = useMemo(() => {
    /*
     * 单一数据源：分组人数和未读数都由页面正在展示的会话列表计算。
     * listConversations 每 5 秒刷新且在 markRead 时会立即乐观清零；不再读取
     * listGroups 的独立 unreadCount，避免两份缓存一新一旧造成残留红点。
     */
    const stats = new Map<number, { count: number; unread: number }>(
      groups.map(group => [group.id, { count: 0, unread: 0 }]),
    );
    for (const conversation of convListQuery.data ?? []) {
      for (const groupId of conversation.groupIds) {
        const stat = stats.get(groupId);
        if (!stat) continue;
        stat.count += 1;
        stat.unread += Math.max(0, Number(conversation.unreadCount ?? 0));
      }
    }
    return stats;
  }, [groups, convListQuery.data]);

  if (loading) return <ChatEntryAuthWait />;

  // ─── 未登录：仅使用商城登录弹窗，并保留当前完整 URL 供登录后继续询价 ───
  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="text-center">
          <p className="text-gray-500 mb-4">请先登录后使用聊一聊功能</p>
          <button
            onClick={() => setLoginOpen(true)}
            className="px-6 py-2 bg-[#185FA5] text-white rounded-lg text-sm"
          >
            去登录
          </button>
        </div>
        <MallLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  /*
   * 分组的会话数与未读数直接从已有的会话列表派生，
   * 不另写后端聚合查询。
   *
   * 原因是口径一致性：listConversations 已经带了 groupName 与
   * unreadCount，且已按 deleted = 0 过滤。若另写一个 SQL 统计，
   * 两边对软删除、孤儿会话的处理稍有差异，就会出现
   * 「侧栏显示 3 个会话、点进去只有 2 个」这种用户无法理解的错位。
   */
  /*
   * 空分组默认折叠。
   *
   * 生产数据里 7 个分组有 4 个是空的，侧栏被空组占满后
   * 真正在用的分组反而不显眼。选择折叠而非隐藏：
   * 刚建好的分组必然是空的，直接隐藏会让用户以为建失败了。
   * 正在筛选的分组即使为空也始终可见，否则选中项会凭空消失。
   */
  const nonEmptyGroups = groups.filter(
    g => (groupStats.get(g.id)?.count ?? 0) > 0 || g.id === groupFilter,
  );
  const emptyGroups = groups.filter(
    g => (groupStats.get(g.id)?.count ?? 0) === 0 && g.id !== groupFilter,
  );
  const visibleGroups = showEmptyGroups ? [...nonEmptyGroups, ...emptyGroups] : nonEmptyGroups;
  const showInquiryDeliveryCard = Boolean(
    inquiryIntent
      && inquiryDelivery
      && inquiryDelivery.userId === user.id
      && inquiryDelivery.enterpriseId === enterpriseScopeId
      && inquiryDelivery.inventoryId === inquiryIntent.inventoryId,
  );
  const handleInquiryDeliveryAction = () => {
    if (!inquiryDelivery) return;
    if (inquiryDelivery.phase === "login") {
      setLoginOpen(true);
      return;
    }
    if (inquiryDelivery.phase === "sent" && inquiryDelivery.conversationId) {
      setActiveConvId(inquiryDelivery.conversationId);
      setInquiryDelivery(null);
      navigate("/chat", { replace: true });
      void utils.chat.listConversations.invalidate();
      return;
    }
    void checkInquiryDelivery(inquiryDelivery.phase === "unsent", inquiryDelivery.key);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f5f5f5] font-sans text-[13px]">
      {/* Dashboard is the sole host chrome in the business workbench. */}
      {/* ── 主体三栏 ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── 左侧边栏 172px ── */}
        <aside className="hidden lg:block w-[172px] min-w-[172px] bg-white border-r border-gray-200 py-2.5 overflow-y-auto">
          <div className="text-[11px] text-gray-400 px-3.5 pt-3 pb-1 tracking-wide">消息</div>
          {(["all", "unread", "pinned"] as const).map((s) => {
            const SectionIcon = s === "all" ? MessageCircle : s === "unread" ? Mail : Pin;
            return (
            <div
              key={s}
              data-testid={`chat-sidebar-${s}`}
              onClick={() => {
                // 分组筛选与区块筛选是叠加关系，切区块时必须同时清掉
                // 分组，否则点“全部会话”后列表仍被上一个分组锁住。
                setSidebarSection(s);
                setGroupFilter(null);
              }}
              className={`text-[13px] px-3.5 py-2 cursor-pointer flex items-center gap-2 ${
                sidebarSection === s && !groupFilter
                  ? "text-[#185FA5] bg-[#e8f0fe] font-medium"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <SectionIcon className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
              <span>{s === "all" ? "全部会话" : s === "unread" ? "未读消息" : "已置顶"}</span>
              {s === "unread" ? (
                <ChatUnreadBadge
                  count={unreadConversationCount}
                  placement="inline"
                  ariaLabel={`${unreadConversationCount} 个未读会话`}
                  className="ring-0"
                />
              ) : null}
            </div>
            );
          })}

          <div
            className="text-[11px] text-gray-400 px-3.5 pt-4 pb-1 tracking-wide font-medium"
            title="多家供应商的一对一会话集合，供应商之间互不可见"
          >
            询价分组
          </div>
          {groupsQuery.isLoading ? (
            <div className="px-3.5 py-2 text-[11px] text-gray-400">正在加载分组…</div>
          ) : groupsQuery.isError ? (
            <button
              type="button"
              className="mx-3.5 my-1 border-0 bg-transparent p-0 text-left text-[11px] text-red-600 underline"
              onClick={() => void groupsQuery.refetch()}
            >
              分组加载失败，点击重试
            </button>
          ) : (
            <>
              {visibleGroups.map((g) => {
                const stat = groupStats.get(g.id);
                const memberCount = stat?.count ?? 0;
                const unread = stat?.unread ?? 0;
                const isDropTarget = dragOverGroup === g.id;
                return (
                  <div
                    key={g.id}
                    data-testid="chat-group-item"
                    /* 拖拽放置区：dragOver 必须 preventDefault 才会触发 drop */
                    onDragOver={(e) => {
                      if (draggingConvId == null) return;
                      e.preventDefault();
                      setDragOverGroup(g.id);
                    }}
                    onDragLeave={() => {
                      setDragOverGroup(prev => (prev === g.id ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropOnGroup(g.id, g.groupName);
                    }}
                    className={`group/gitem relative text-[13px] px-3.5 py-2 cursor-pointer flex items-center gap-2 ${
                      isDropTarget
                        ? "bg-[#dbeafe] ring-1 ring-inset ring-[#185FA5] text-[#185FA5]"
                        : groupFilter === g.id
                          ? "text-[#185FA5] bg-[#e8f0fe] font-medium"
                          : "text-gray-500 hover:bg-gray-100"
                    }`}
                    onClick={() => {
                      setFilter("all");
                      setSidebarSection("all");
                      setSearchQuery("");
                      setGroupFilter(groupFilter === g.id ? null : g.id);
                    }}
                  >
                    <UsersRound className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={g.partNumbers.length > 0 ? `${g.groupName} · 型号：${g.partNumbers.join("、")}` : g.groupName}
                    >
                      {g.groupName}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">{memberCount}家</span>
                    {/* 未读角标：不必逐个点进分组就能知道哪个组有新消息 */}
                    <ChatUnreadBadge
                      count={unread}
                      placement="inline"
                      ariaLabel={`${g.groupName}分组有 ${unread} 条未读消息`}
                      className="ring-0"
                    />
                    {/* 操作入口：悬停才出现，不占用平时的横向空间 */}
                    <button
                      type="button"
                      data-testid="chat-group-menu-btn"
                      title="分组操作"
                      className={`${unread > 0 ? "" : "ml-auto"} shrink-0 border-0 bg-transparent p-0 text-gray-400 opacity-0 group-hover/gitem:opacity-100 hover:text-gray-700`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupMenuOpen(prev => (prev === g.id ? null : g.id));
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {groupMenuOpen === g.id && (
                      <div
                        className="absolute right-2 top-8 z-20 w-[128px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="block w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setGroupRenaming({ groupId: g.id, oldName: g.groupName });
                            setGroupRenameInput(g.groupName);
                            setGroupMenuOpen(null);
                          }}
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          className="block w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setGroupMerging({ groupId: g.id, groupName: g.groupName, memberCount });
                            setMergeTargetGroupId(null);
                            setGroupMenuOpen(null);
                          }}
                        >
                          合并到…
                        </button>
                        <button
                          type="button"
                          className="block w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setGroupTrashing({ groupId: g.id, groupName: g.groupName, memberCount });
                            setGroupMenuOpen(null);
                          }}
                        >
                          删除分组
                        </button>
                        <button
                          type="button"
                          className="block w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-100"
                          onClick={() => {
                            setGroupDissolving({ groupId: g.id, groupName: g.groupName, memberCount });
                            setGroupMenuOpen(null);
                          }}
                        >
                          解散分组
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* 空分组折叠开关：仅在确实存在空分组时出现 */}
              {emptyGroups.length > 0 && (
                <button
                  type="button"
                  data-testid="chat-empty-groups-toggle"
                  className="w-full border-0 bg-transparent px-3.5 py-1.5 text-left text-[11px] text-gray-400 hover:text-gray-600"
                  onClick={() => setShowEmptyGroups(v => !v)}
                >
                  {showEmptyGroups
                    ? "收起空分组"
                    : `展开 ${emptyGroups.length} 个空分组`}
                </button>
              )}
            </>
          )}
          <div
            onClick={() => setShowGroupModal(true)}
            className="text-[12px] px-3.5 py-2 cursor-pointer text-[#185FA5] hover:bg-[#f0f4ff] flex items-center gap-2"
          >
            <span>＋</span>
            <span>新建分组</span>
          </div>
          {trashedGroups.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowGroupTrash(true)}
              className="flex w-full items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left text-[11px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
            >
              <Archive size={13} />
              最近删除（{trashedGroups.length}）
            </button>
          ) : null}
        </aside>

        {/* ── 会话列表 240px ── */}
        <div className={`${showInquiryDeliveryCard ? "hidden md:flex" : activeConv ? "hidden md:flex" : "flex"} w-full md:w-[280px] md:min-w-[280px] lg:w-[240px] lg:min-w-[240px] bg-white border-r border-gray-200 flex-col`}>
          {/* 标题和搜索 */}
          <div className="px-3 pt-2.5 pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-gray-900">
                {activeGroup ? <UsersRound size={14} className="shrink-0 text-[#185FA5]" /> : null}
                <span className="truncate">{activeGroup?.groupName || "会话"}</span>
                {activeGroup ? <span className="shrink-0 text-[10px] font-normal text-gray-400">{activeGroup.memberCount}家</span> : null}
              </span>
            </div>
            <div className="relative h-[30px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索联系人..."
                className="w-full h-[30px] pl-8 pr-2.5 border border-gray-300 rounded-md bg-gray-50 text-xs focus:border-[#185FA5] focus:bg-white outline-none"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                🔍
              </span>
            </div>
          </div>

          {/* 筛选标签 */}
          <div className="flex gap-1 px-3 py-1.5 border-b border-gray-100">
            {(["all", "unread", "pinned"] as const).map((f) => (
              <span
                key={f}
                onClick={() => setFilter(f)}
                className={`inline-flex min-h-[22px] items-center text-[11px] px-2 py-0.5 rounded-full cursor-pointer border ${
                  filter === f
                    ? "bg-[#e8f0fe] text-[#185FA5] border-[#b3cfe8] font-medium"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span>{f === "all" ? "全部" : f === "unread" ? "未读" : "置顶"}</span>
                {f === "unread" ? (
                  <ChatUnreadBadge
                    count={unreadConversationCount}
                    placement="inline"
                    ariaLabel={`${unreadConversationCount} 个未读会话`}
                    className="ml-1 ring-0"
                  />
                ) : null}
              </span>
            ))}
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto">
            {convListQuery.isLoading ? (
              <div className="py-7 text-center text-gray-400 text-[11px]">正在加载会话…</div>
            ) : convListQuery.isError ? (
              <div className="py-7 text-center text-[11px]">
                <p className="text-red-600">会话加载失败</p>
                <button
                  type="button"
                  className="mt-2 border-0 bg-transparent p-0 text-[#185FA5] underline"
                  onClick={() => void convListQuery.refetch()}
                >
                  重新加载
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="py-7 text-center text-gray-400 text-[11px]">没有找到相关会话</div>
            ) : (
              filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => {
                    shouldStickToBottomRef.current = true;
                    setMessageListAtBottom(true);
                    setActiveConvId(conv.id);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, conv.id)}
                  /*
                   * 拖拽到侧栏分组即可加入归类，替代「三点菜单→加入询价分组
                   * →选组」的三步操作（三点菜单仍保留，触控设备与无鼠标
                   * 场景不适用拖拽）。
                   * 原生 draggable 仅在真正按住并移动时才触发 dragstart，
                   * 单纯点击不会误判为拖拽，不会影响打开会话。
                   */
                  draggable
                  onDragStart={(e) => {
                    setDraggingConvId(conv.id);
                    e.dataTransfer.effectAllowed = "copy";
                    // 部分浏览器不设 setData 不触发 drop
                    e.dataTransfer.setData("text/plain", String(conv.id));
                  }}
                  onDragEnd={() => {
                    setDraggingConvId(null);
                    setDragOverGroup(null);
                  }}
                  className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-50 relative ${
                    draggingConvId === conv.id ? "opacity-50" : ""
                  } ${
                    conv.id === activeConvId
                      ? "bg-[#EEF4FF] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-[#185FA5]"
                      : conv.unreadCount > 0
                        ? "bg-[#F7FAFF] hover:bg-[#EEF4FF]"
                      : conv.pinned
                        ? "bg-[#fffdf5]"
                        : "hover:bg-gray-50"
                  } ${conv.unreadCount > 0 ? "[&_.conv-name]:font-semibold [&_.conv-preview]:font-medium [&_.conv-preview]:text-gray-700" : ""}`}
                >
                  {/* 头像 */}
                  <div
                    className={`w-9 h-9 rounded-[9px] flex items-center justify-center text-[13px] font-semibold text-white shrink-0 relative overflow-visible ${isServiceName(conv.otherUserOriginalName) || conv.otherUserAvatar ? "" : getAvatarColor(conv.otherUserId)}`}
                  >
                    {isServiceName(conv.otherUserOriginalName) ? (
                      <ServiceAvatar size="lg" />
                    ) : (
                      <UserAvatar
                        avatarUrl={conv.otherUserAvatar}
                        name={conv.otherUserName}
                        userId={conv.otherUserId}
                        className="w-9 h-9 rounded-[9px] text-[13px]"
                        fallbackClassName={getAvatarColor(conv.otherUserId)}
                      />
                    )}
                  </div>
                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-0.5">
                      <span
                        className="conv-name text-xs text-gray-900 truncate flex-1"
                        title={conv.otherUserName}
                      >
                        {conv.otherUserName}
                      </span>
                      {/*
                        官方客服显示「官方」标识，不用置顶图钉。
                        图钉代表「我自己置顶的」，而官方位置是系统固定的；
                        用同一个图标会让用户以为是自己操作的，并去找取消入口。
                      */}
                      {conv.isService && !groupFilter && (
                        <span
                          className="shrink-0 rounded px-1 py-px text-[9px] font-medium text-[#185FA5] bg-[#e8f0fe]"
                          aria-label="官方客服，已固定在顶部"
                          title="官方客服，已固定在顶部"
                        >官方</span>
                      )}
                      {conv.pinned && !conv.isService && !groupFilter && (
                        <Pin className="w-3 h-3 text-[#185FA5] shrink-0" aria-label="已置顶" />
                      )}
                      {/* 分组视图下把置顶图标换成可点击按钮：
                          分组内会话数量有限且常需调整优先级，
                          直接点击比“开更多菜单再选置顶”少两步操作。
                          官方会话不给按钮：它不参与用户置顶，点了也不会改变位置。 */}
                      {groupFilter && !conv.isService && (
                        <button
                          type="button"
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent ${
                            conv.pinned
                              ? "text-[#185FA5] hover:bg-[#e8f0fe]"
                              : "text-gray-400 hover:bg-gray-100 hover:text-[#185FA5]"
                          }`}
                          aria-label={conv.pinned ? "取消置顶会话" : "置顶会话"}
                          title={conv.pinned ? "取消置顶" : "在当前分组置顶"}
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePinConversation(conv.id);
                          }}
                        >
                          <Pin
                            className="h-3.5 w-3.5"
                            fill={conv.pinned ? "currentColor" : "none"}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                      <button
                        type="button"
                        className="w-6 h-6 -mr-1 inline-flex items-center justify-center rounded-md border-0 bg-transparent text-gray-400 hover:bg-gray-100 hover:text-[#185FA5]"
                        aria-label={`打开${conv.otherUserName}的更多操作`}
                        title="更多操作"
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setCtxMenu({
                            x: Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152)),
                            y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 248)),
                            convId: conv.id,
                          });
                        }}
                      >
                        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="conv-preview min-w-0 flex-1 truncate text-[11px] text-gray-400">
                        {conv.lastMessagePreview}
                      </div>
                      <ChatUnreadBadge
                        count={conv.unreadCount}
                        placement="inline"
                        ariaLabel={`${conv.otherUserName}有 ${conv.unreadCount} 条未读消息`}
                        className="ring-0"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── 聊天窗口 ── */}
        <div className={`${showInquiryDeliveryCard ? "flex" : activeConv ? "flex" : "hidden md:flex"} relative flex-1 flex-col min-w-0 bg-[#f0f2f5]`}>
          {showInquiryDeliveryCard ? (
            <div className="flex flex-1 items-center justify-center px-4 py-8">
              <section
                role="status"
                aria-live="polite"
                className="w-full max-w-md rounded-xl border border-gray-200 bg-white px-5 py-6 text-center shadow-sm"
              >
                <h2 className="text-base font-semibold text-gray-900">
                  {inquiryDelivery?.phase === "sent"
                    ? "询价已发送"
                    : inquiryDelivery?.phase === "unsent"
                      ? "询价尚未发送"
                      : inquiryDelivery?.phase === "login"
                        ? "登录已失效"
                        : inquiryDelivery?.phase === "unavailable"
                          ? "暂时无法核对"
                          : inquiryDelivery?.phase === "checking"
                            ? "正在核对询价状态"
                            : "询价状态待确认"}
                </h2>
                <p className="mt-2 text-[13px] text-gray-600">
                  {inquiryIntent?.partNumber}
                  {inquiryIntent?.qty != null ? ` · ${inquiryIntent.qty.toLocaleString("zh-CN")}片` : ""}
                </p>
                <p className="mt-2 text-[12px] text-gray-500">
                  {inquiryDelivery?.phase === "unsent"
                    ? "可发送给供应商。"
                    : inquiryDelivery?.phase === "login"
                      ? "请重新登录后核对。"
                      : inquiryDelivery?.phase === "unavailable"
                        ? "请稍后重新核对。"
                        : inquiryDelivery?.phase === "pending"
                          ? "请先核对，避免重复发送。"
                          : ""}
                </p>
                <button
                  type="button"
                  disabled={inquiryDelivery?.phase === "checking"}
                  onClick={handleInquiryDeliveryAction}
                  className="mt-5 rounded-lg bg-[#185FA5] px-6 py-2 text-[13px] font-medium text-white hover:bg-[#0C447C] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inquiryDelivery?.phase === "login"
                    ? "重新登录"
                    : inquiryDelivery?.phase === "sent"
                      ? "进入会话"
                      : inquiryDelivery?.phase === "unsent"
                        ? "发送询价"
                        : inquiryDelivery?.phase === "checking"
                          ? "核对中…"
                          : inquiryDelivery?.phase === "unavailable"
                            ? "重新核对"
                            : "核对状态"}
                </button>
                <button
                  type="button"
                  disabled={inquiryDelivery?.phase === "checking"}
                  onClick={() => {
                    setInquiryDelivery(null);
                    navigate("/chat", { replace: true });
                  }}
                  className="mx-auto mt-3 block border-0 bg-transparent text-xs text-gray-500 underline-offset-2 hover:text-[#185FA5] hover:underline disabled:opacity-50"
                >
                  聊天记录
                </button>
              </section>
            </div>
          ) : !activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-2">
              <span className="text-[40px]">💬</span>
              <span className="text-xs">选择一个会话开始聊天</span>
            </div>
          ) : (
            <>
              {/* 聊天头部 */}
              <div className="bg-white border-b border-gray-200 px-3 md:px-4 h-12 flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveConvId(null)}
                  className="md:hidden mr-2 w-8 h-8 inline-flex items-center justify-center rounded-md border-0 bg-transparent text-xl text-gray-600 hover:bg-gray-100"
                  aria-label="返回会话列表"
                >
                  ←
                </button>
                {isServiceName(activeConv.otherUserOriginalName) ? (
                  <ServiceAvatar size="md" className="mr-2" />
                ) : (
                  <button
                    type="button"
                    onClick={openActiveContactProfile}
                    className="mr-2 shrink-0 rounded-lg border-0 bg-transparent p-0 transition hover:ring-2 hover:ring-[#185FA5]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/40"
                    aria-label={`查看${activeConv.otherUserName}的联系人资料`}
                    title="查看联系人资料"
                  >
                    <UserAvatar
                      avatarUrl={activeConv.otherUserAvatar}
                      name={activeConv.otherUserName}
                      userId={activeConv.otherUserId}
                      className="h-8 w-8 rounded-lg text-xs"
                      fallbackClassName={getAvatarColor(activeConv.otherUserId)}
                    />
                  </button>
                )}
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">
                    {activeConv.otherCompanyProfileSupplierId ? (
                      <a
                        href={`/company/${activeConv.otherCompanyProfileSupplierId}`}
                        className="text-[#185FA5] hover:text-[#0C447C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/30 rounded-sm"
                        title="查看企业详情"
                      >
                        {activeConv.otherUserName}
                      </a>
                    ) : (
                      activeConv.otherUserName
                    )}
                  </div>
                  {!activeConv.remarkName && isServiceName(activeConv.otherUserOriginalName) ? (
                    <div className="text-[10px] text-emerald-600 leading-none mt-0.5">在线 · 官方客服</div>
                  ) : null}
                </div>
                {/* 企业会话始终提供“评论”入口；历史评论的追加操作只在对应评论卡片中出现。 */}
                {!isServiceConv && (
                  <div
                    className="ml-auto flex shrink-0 items-center gap-1.5 pl-2"
                    data-testid="chat-round-actions"
                  >
                    <button
                      type="button"
                      onClick={handleOpenReview}
                      disabled={reviewStateQuery.isLoading}
                      className="rounded-md border border-[#b3cfe8] bg-white px-2 py-1 text-[11px] font-medium text-[#185FA5] hover:bg-[#e8f0fe] disabled:cursor-default disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
                    >
                      评论
                    </button>
                  </div>
                )}
              </div>

              {/* 消息列表 */}
              <div
                ref={msgListRef}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  setMessageMenu(null);
                  const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
                  const atBottom = distanceToBottom < 80;
                  shouldStickToBottomRef.current = atBottom;
                  setMessageListAtBottom(previous => previous === atBottom ? previous : atBottom);
                }}
                data-testid="chat-message-list"
                className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-5 flex flex-col gap-3"
              >
                {messagesQuery.isLoading ? (
                  <div className="m-auto text-xs text-gray-400">正在加载消息…</div>
                ) : messagesQuery.isError ? (
                  <div className="m-auto text-center text-xs">
                    <p className="text-red-600">消息加载失败</p>
                    <button
                      type="button"
                      className="mt-2 border-0 bg-transparent p-0 text-[#185FA5] underline"
                      onClick={() => void messagesQuery.refetch()}
                    >
                      重新加载
                    </button>
                  </div>
                ) : orderedMessages.length ? (
                  orderedMessages.map((msg) => (
                    <MessageActionTarget
                      key={msg.id}
                      message={msg}
                      isMe={msg.senderId === user.id}
                      replyAuthor={msg.replyTo?.senderId === user.id ? "我" : activeConv.otherUserName}
                      onOpenMenu={(x, y) => openMessageMenu(msg, x, y)}
                    >
                      <MessageBubble
                        msg={msg}
                        isMe={msg.senderId === user.id}
                        myName={accountDisplayName(user, "我")}
                        otherName={activeConv.otherUserOriginalName}
                        myAvatar={(user as { avatarUrl?: string | null }).avatarUrl}
                        otherAvatar={activeConv.otherUserAvatar}
                        peerLastReadMessageId={peerLastReadMessageId}
                        onRetry={() => handleRetryMessage(msg)}
                        onOpenImagePreview={openChatImagePreview}
                        onAvatarClick={isServiceConv ? undefined : openActiveContactProfile}
                        onOpenMenu={(x, y) => openMessageMenu(msg, x, y)}
                        businessReception={businessReception}
                      />
                    </MessageActionTarget>
                  ))
                ) : (
                  <div className="m-auto text-xs text-gray-400">暂无消息，发送第一条消息开始沟通</div>
                )}
              </div>

              {(activeConv.unreadCount ?? 0) > 0 && !messageListAtBottom ? (
                <button
                  type="button"
                  data-testid="chat-new-message-jump"
                  className="absolute bottom-[106px] left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#c5d9ec] bg-white px-3 py-1.5 text-[11px] font-medium text-[#185FA5] shadow-md hover:bg-[#eef5fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/30"
                  onClick={() => {
                    const list = msgListRef.current;
                    if (list) list.scrollTop = list.scrollHeight;
                    shouldStickToBottomRef.current = true;
                    setMessageListAtBottom(true);
                  }}
                  aria-label={`查看 ${activeConv.unreadCount} 条新消息`}
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  {activeConv.unreadCount > 99 ? "99+" : activeConv.unreadCount} 条新消息
                </button>
              ) : null}

              {/* 输入区 */}
              <div className="relative bg-white border-t border-gray-200 shrink-0">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleImageInput}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {activeConversationBlocked && (
                  <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800">
                    该会话已被屏蔽，双方暂不能发送消息
                  </div>
                )}
                {replyingTo ? (
                  <div
                    data-testid="chat-reply-composer"
                    className="flex items-center gap-2 border-b border-[#dbe7f5] bg-[#f7fbff] px-3 py-1.5"
                  >
                    <Reply className="h-3.5 w-3.5 shrink-0 text-[#185FA5]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-medium text-[#185FA5]">
                        引用{replyingTo.senderId === user.id ? "自己" : activeConv.otherUserName}
                      </div>
                      <div className="truncate text-[11px] text-gray-500">{compactMessageSummary(replyingTo)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      aria-label="取消引用"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-0 bg-transparent text-gray-400 hover:bg-white hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-50">
                  <button
                    type="button"
                    aria-label="打开51表情包"
                    aria-expanded={stickerPickerOpen}
                    title={activeConv.isService ? "客服会话暂不支持表情" : "51表情包"}
                    disabled={activeConv.isService || activeConversationBlocked}
                    onClick={() => {
                      setAttachmentMenuOpen(false);
                      if (!stickerPickerOpen) setStickerPack("noto");
                      setStickerPickerOpen((open) => !open);
                    }}
                    className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-[#cfe0f1] bg-[#f3f7fb] p-0.5 hover:bg-[#e6f0fa] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <img
                        src={chatStickerPickerIcon}
                        alt="开心笑脸"
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                  </button>
                  {stickerPickerOpen && !activeConv.isService ? (
                    <div
                      role="dialog"
                      aria-label="51表情包"
                      className="absolute bottom-[calc(100%_-_2px)] left-3 z-50 mb-2 w-[min(360px,calc(100vw-32px))] rounded-xl border border-[#cfe0f1] bg-white p-2.5 shadow-xl"
                    >
                      <div className="mb-2 flex items-center justify-between border-b border-gray-100">
                        <div role="tablist" aria-label="表情分类" className="flex h-10 items-stretch gap-1">
                          <button
                            type="button"
                            role="tab"
                            aria-label="Noto表情"
                            aria-selected={stickerPack === "noto"}
                            onClick={() => setStickerPack("noto")}
                            className={`relative flex w-12 items-center justify-center border-0 bg-transparent p-0 ${stickerPack === "noto" ? "rounded-t-md bg-[#f2f6fa] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#185FA5]" : "opacity-60 hover:opacity-100"}`}
                          >
                            <img src={chatNotoPackIcon} alt="" className="h-7 w-7 object-contain" draggable={false} />
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-label="小电表情"
                            aria-selected={stickerPack === "emoji"}
                            onClick={() => setStickerPack("emoji")}
                            className={`relative flex w-12 items-center justify-center border-0 bg-transparent p-0 ${stickerPack === "emoji" ? "rounded-t-md bg-[#f2f6fa] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#185FA5]" : "opacity-60 hover:opacity-100"}`}
                          >
                            <img src={chatEmojiPackIcon} alt="" className="h-7 w-7 object-contain" draggable={false} />
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-label="芽芽团表情"
                            aria-selected={stickerPack === "yayatuan"}
                            onClick={() => setStickerPack("yayatuan")}
                            className={`relative flex w-12 items-center justify-center border-0 bg-transparent p-0 ${stickerPack === "yayatuan" ? "rounded-t-md bg-[#f2f6fa] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#185FA5]" : "opacity-60 hover:opacity-100"}`}
                          >
                            <img src={chatYayatuanPackIcon} alt="" className="h-7 w-7 object-contain" draggable={false} />
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-label="商务表情"
                            aria-selected={stickerPack === "business"}
                            onClick={() => setStickerPack("business")}
                            className={`relative flex w-12 items-center justify-center border-0 bg-transparent p-0 ${stickerPack === "business" ? "rounded-t-md bg-[#f2f6fa] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#185FA5]" : "opacity-60 hover:opacity-100"}`}
                          >
                            <img src={chatBusinessPackIcon} alt="" className="h-7 w-7 object-contain" draggable={false} />
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label="关闭表情包"
                          onClick={() => setStickerPickerOpen(false)}
                          className="border-0 bg-transparent px-1 text-sm text-gray-400 hover:text-gray-600"
                        >
                          ×
                        </button>
                      </div>
                      <div className="max-h-[320px] overflow-y-auto pr-0.5">
                        {stickerPack === "noto" ? (
                          <div className="space-y-2">
                            {recentStickers.length > 0 ? (
                              <div className="border-b border-gray-100 pb-2">
                                <div className="mb-1 px-1 text-[10px] font-medium text-gray-400">最近使用</div>
                                <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                                  {recentStickers.map((sticker) => (
                                    <button
                                      key={`recent-${sticker.id}`}
                                      type="button"
                                      title={sticker.label}
                                      aria-label={`最近使用：${sticker.label}`}
                                      onClick={() => handleSendSticker(sticker.id)}
                                      className="group aspect-square border-0 bg-transparent p-1 cursor-pointer"
                                    >
                                      <img
                                        src={sticker.thumbnailUrl}
                                        alt=""
                                        className="h-full w-full rounded-md object-contain transition group-hover:bg-[#eef4fa] group-active:scale-95"
                                        draggable={false}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                              {NOTO_CHAT_STICKERS.map((sticker) => (
                                <button
                                  key={sticker.id}
                                  type="button"
                                  title={sticker.label}
                                  aria-label={sticker.label}
                                  onClick={() => handleSendSticker(sticker.id)}
                                  className="group aspect-square border-0 bg-transparent p-1 cursor-pointer"
                                >
                                  <img
                                    src={sticker.thumbnailUrl}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full rounded-md object-contain transition group-hover:bg-[#eef4fa] group-active:scale-95"
                                    draggable={false}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : stickerPack === "emoji" ? (
                          <div className="grid grid-cols-8 gap-1">
                            {EMOJI_CHAT_STICKERS.map((sticker) => (
                              <button
                                key={sticker.id}
                                type="button"
                                title={sticker.label}
                                aria-label={sticker.label}
                                onClick={() => handleSendSticker(sticker.id)}
                                className="group aspect-square border-0 bg-transparent p-0.5 cursor-pointer"
                              >
                                <img
                                  src={sticker.thumbnailUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full rounded-md object-contain transition group-hover:bg-[#eef4fa] group-active:scale-95"
                                  draggable={false}
                                />
                              </button>
                            ))}
                          </div>
                        ) : stickerPack === "yayatuan" ? (
                          <div className="grid grid-cols-4 gap-1.5">
                            {YAYATUAN_CHAT_STICKERS.map((sticker) => (
                              <button
                                key={sticker.id}
                                type="button"
                                title={sticker.label}
                                aria-label={sticker.label}
                                onClick={() => handleSendSticker(sticker.id)}
                                className="group aspect-square border-0 bg-transparent p-0.5 cursor-pointer"
                              >
                                <img
                                  src={sticker.thumbnailUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full rounded-md object-contain transition group-hover:bg-[#f8f5ef] group-active:scale-95"
                                  draggable={false}
                                />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-2">
                            {BUSINESS_CHAT_STICKERS.map((sticker) => (
                              <button
                                key={sticker.id}
                                type="button"
                                title={sticker.label}
                                onClick={() => handleSendSticker(sticker.id)}
                                className="group border-0 bg-transparent p-0 text-center cursor-pointer"
                              >
                                <img
                                  src={sticker.thumbnailUrl}
                                  alt={sticker.label}
                                  loading="lazy"
                                  className="aspect-square w-full rounded-lg border border-transparent object-cover transition group-hover:border-[#79a9d4] group-hover:shadow-sm"
                                  draggable={false}
                                />
                                <span className="mt-0.5 block truncate text-[9px] text-gray-500">
                                  {sticker.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label="更多聊天功能"
                    aria-expanded={attachmentMenuOpen}
                    title="发送图片或文件"
                    disabled={attachmentBusy || activeConversationBlocked}
                    onClick={() => {
                      setStickerPickerOpen(false);
                      setAttachmentMenuOpen((open) => !open);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-[#cfe0f1] bg-white text-[#185FA5] hover:bg-[#e6f0fa] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {attachmentMenuOpen ? (
                    <div
                      role="dialog"
                      aria-label="聊天附件"
                      className="absolute bottom-[calc(100%_-_2px)] left-12 z-50 mb-2 w-[180px] rounded-xl border border-[#cfe0f1] bg-white p-2 shadow-xl"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          aria-label="上传聊天图片"
                          title="上传图片（JPG、PNG、WebP，最大 10MB）"
                          onClick={() => {
                            setAttachmentMenuOpen(false);
                            imageInputRef.current?.click();
                          }}
                          className="flex flex-col items-center gap-1 rounded-lg border-0 bg-[#f7fbff] px-2 py-3 text-[11px] text-[#185FA5] hover:bg-[#e6f0fa]"
                        >
                          <ImageIcon className="h-5 w-5" aria-hidden="true" />
                          <span>图片</span>
                        </button>
                        <button
                          type="button"
                          aria-label="上传聊天文件"
                          title="上传文件（PDF、Word、Excel、CSV、TXT，最大 20MB）"
                          onClick={() => {
                            setAttachmentMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                          className="flex flex-col items-center gap-1 rounded-lg border-0 bg-[#f7fbff] px-2 py-3 text-[11px] text-[#185FA5] hover:bg-[#e6f0fa]"
                        >
                          <Paperclip className="h-5 w-5" aria-hidden="true" />
                          <span>文件</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <button
                    onClick={() => setShowQuoteModal(true)}
                    disabled={activeConversationBlocked}
                    className="text-[11px] text-[#185FA5] px-2 py-0.5 rounded hover:bg-[#e8f0fe] border border-[#b3cfe8] bg-white cursor-pointer font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    title="发送报价单"
                  >
                    💰 发报价单
                  </button>
                  {attachmentBusy ? (
                    <span className="ml-auto text-[10px] text-[#185FA5]">附件处理中…</span>
                  ) : null}
                </div>
                <div className="flex items-end gap-2 px-3 py-1.5">
                  <textarea
                    ref={msgInputRef}
                    value={msgInput}
                    onChange={(e) => setMsgInput(e.target.value)}
                    onFocus={closeComposerPanels}
                    onKeyDown={handleKeyDown}
                    placeholder={activeConversationBlocked ? "该会话已被屏蔽" : "输入消息，Enter 发送，Shift+Enter 换行…"}
                    disabled={activeConversationBlocked}
                    className="flex-1 border-none outline-none text-xs resize-none h-[52px] text-gray-900 bg-transparent leading-relaxed disabled:cursor-not-allowed disabled:text-gray-400"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!msgInput.trim() || activeConversationBlocked}
                    className="px-4 py-1.5 bg-[#185FA5] text-white border-none rounded-[7px] text-xs cursor-pointer shrink-0 self-end hover:bg-[#0C447C] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    发 送
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 右键菜单 ── */}
      {ctxMenu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg z-[999] min-w-[120px] py-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {/*
            官方客服不展示置顶项：它已固定在顶部，
            给一个点了不会生效的菜单项，比没有这个项更让人迷惑。
          */}
          {!(convListQuery.data ?? []).find((c) => c.id === ctxMenu.convId)?.isService && (
            <CtxMenuItem
              label={
                (convListQuery.data ?? []).find((c) => c.id === ctxMenu.convId)?.pinned
                  ? "取消置顶"
                  : "置顶会话"
              }
              icon="📌"
              onClick={() => handlePinConversation(ctxMenu.convId)}
            />
          )}
          <CtxMenuItem
            label={
              (convListQuery.data ?? []).find((c) => c.id === ctxMenu.convId)?.remarkName
                ? "修改备注名"
                : "设置备注名"
            }
            icon="✎"
            onClick={() => openRemarkEditor(ctxMenu.convId)}
          />
          <CtxMenuItem
            label="标为已读"
            icon="✅"
            onClick={() => {
              markReadMut.mutate({ conversationId: ctxMenu.convId });
              setCtxMenu(null);
            }}
          />
          {/* 同一供应商可属于多个型号项目，因此这里是独立勾选而非单值移动。 */}
          <div className="relative group/grp">
            <div className="px-3.5 py-1.5 text-xs cursor-pointer flex items-center gap-1.5 hover:bg-gray-100 text-gray-700 justify-between">
              <span className="inline-flex items-center gap-1.5"><UsersRound size={13} /> 加入询价分组</span>
              <span className="text-[10px] text-gray-400">▶</span>
            </div>
            <div className="absolute left-full top-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[100px] py-1 hidden group-hover/grp:block">
              {groups.length === 0 ? (
                <div className="px-3 py-1.5 text-[11px] text-gray-400">暂无分组</div>
              ) : (
                groups.map((g) => {
                  const conv = (convListQuery.data ?? []).find((c) => c.id === ctxMenu.convId);
                  const isCurrent = conv?.groupIds.includes(g.id) ?? false;
                  return (
                    <div
                      key={g.id}
                      className="px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-100 text-gray-700"
                      onClick={() => {
                        setGroupMembershipMut.mutate(
                          { conversationId: ctxMenu.convId, groupId: g.id, included: !isCurrent },
                          {
                            onSuccess: () => {
                              void utils.chat.listConversations.invalidate();
                              void utils.chat.listGroups.invalidate();
                            },
                          },
                        );
                        setCtxMenu(null);
                      }}
                    >
                      {isCurrent ? "✓ " : ""}{g.groupName}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <CtxMenuItem
            label="删除会话"
            icon="🗑️"
            danger
            onClick={() => {
              deleteConvMut.mutate(
                { conversationId: ctxMenu.convId },
                {
                  onSuccess: () => {
                    if (activeConvId === ctxMenu.convId) setActiveConvId(null);
                    void utils.chat.listConversations.invalidate();
                    void utils.chat.getTotalUnread.invalidate();
                  },
                }
              );
              setCtxMenu(null);
            }}
          />
        </div>
      )}

      {/* 消息操作：桌面右键/悬停省略号，移动端长按共用这一份菜单。 */}
      {messageMenu && (
        <div
          role="menu"
          aria-label="消息操作"
          data-testid="chat-message-action-menu"
          onClick={event => event.stopPropagation()}
          className="fixed z-[1200] min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: messageMenu.x, top: messageMenu.y }}
        >
          {!messageMenu.message.recalledAt ? (
            <MessageMenuItem
              label="引用"
              icon={<Reply className="h-3.5 w-3.5" />}
              onClick={() => handleQuoteMessage(messageMenu.message)}
            />
          ) : null}
          {!messageMenu.message.recalledAt ? (
            <MessageMenuItem
              label="复制"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={() => void handleCopyMessage(messageMenu.message)}
            />
          ) : null}
          {messageMenu.message.senderId === user?.id
            && !messageMenu.message.recalledAt
            && !activeConv?.isService
            && RECALLABLE_MESSAGE_TYPES.has(messageMenu.message.msgType)
            && Date.now() - new Date(messageMenu.message.createdAt).getTime() <= CHAT_MESSAGE_RECALL_WINDOW_MS ? (
              <MessageMenuItem
                label="撤回"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => handleRecallMessage(messageMenu.message)}
              />
            ) : null}
          <MessageMenuItem
            label="删除"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            danger
            onClick={() => handleDeleteMessageForMe(messageMenu.message)}
          />
        </div>
      )}

      {/* ── 实名企业评论弹窗 ── */}
      {reviewTarget && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
          data-testid="chat-public-review-modal"
        >
          <div className="w-full max-w-[460px] rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-[16px] font-semibold text-gray-900">
              企业评论
            </h3>
            <p className="mt-1 text-[12px] text-gray-500">
              {`对「${reviewTarget.otherName}」的内容将实名公开展示`}
            </p>
            <textarea
              value={reviewContent}
              onChange={event => setReviewContent(event.target.value)}
              maxLength={500}
              rows={5}
              autoFocus
              placeholder="请如实描述本次交易或沟通体验"
              className="mt-4 w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#185FA5] focus:ring-2 focus:ring-[#185FA5]/10"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
              <span>内容公开可见，不显示星级、不生成综合评分</span>
              <span>{reviewContent.length}/500</span>
            </div>

            <div className="mt-3">
                <input
                  ref={reviewImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={handleReviewImageInput}
                />
                <div className="flex flex-wrap gap-2">
                  {reviewImages.map(image => (
                    <div key={image.previewUrl} className="relative size-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      <img src={image.previewUrl} alt="评论图片预览" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeReviewImage(image.previewUrl)}
                        aria-label="删除图片"
                        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {reviewImages.length < PUBLIC_REVIEW_IMAGE_LIMIT && (
                    <button
                      type="button"
                      onClick={() => reviewImageInputRef.current?.click()}
                      disabled={reviewImageBusy}
                      className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 text-[11px] text-gray-500 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
                    >
                      <ImagePlus size={19} />
                      {reviewImageBusy ? "处理中" : "上传图片"}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-400">选填，最多3张</p>
            </div>

            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={closeReviewModal}
                className="rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitReview}
                disabled={
                  reviewImageBusy
                  || createReviewMut.isPending
                  || reviewContent.trim().length < 2
                }
                className="rounded-md border-0 bg-[#185FA5] px-4 py-1.5 text-xs text-white hover:bg-[#0C447C] disabled:opacity-50"
              >
                {createReviewMut.isPending ? "提交中…" : "发布评论"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 新建分组弹窗 ── */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center">
          <div className="bg-white rounded-xl p-5 w-[300px] shadow-xl">
            <h3 className="text-sm font-semibold mb-3.5 text-gray-900">新建分组</h3>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              maxLength={12}
              placeholder="请输入分组名称（最多12字）"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
              autoFocus
            />
            <div className="flex gap-2.5 justify-end mt-4">
              <button
                onClick={() => {
                  setShowGroupModal(false);
                  setNewGroupName("");
                }}
                className="px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-gray-500 cursor-pointer text-xs hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleCreateGroup}
                className="px-3.5 py-1.5 border-none rounded-md bg-[#185FA5] text-white cursor-pointer text-xs hover:bg-[#0C447C]"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 分组改名弹窗 ── */}
      {groupRenaming && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-[320px] shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">分组重命名</h3>
            <p className="mt-1 text-[11px] text-gray-500 truncate" title={groupRenaming.oldName}>
              原名称：{groupRenaming.oldName}
            </p>
            <input
              value={groupRenameInput}
              onChange={(e) => setGroupRenameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
              /* 与新建分组同为 12 字：同一功能不能两套限制 */
              maxLength={12}
              placeholder="请输入新分组名（最多12字）"
              className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
              autoFocus
            />
            <div className="flex gap-2.5 justify-end mt-4">
              <button
                onClick={() => {
                  setGroupRenaming(null);
                  setGroupRenameInput("");
                }}
                className="px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-gray-500 cursor-pointer text-xs hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleRenameGroup}
                disabled={renameGroupMut.isPending}
                className="px-3.5 py-1.5 border-none rounded-md bg-[#185FA5] text-white cursor-pointer text-xs hover:bg-[#0C447C] disabled:opacity-60"
              >
                {renameGroupMut.isPending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 合并分组：成员和型号规则一并迁入目标，重复供应商自动去重 ── */}
      {groupMerging && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-xl">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Combine size={16} /> 合并分组
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              将「{groupMerging.groupName}」的 {groupMerging.memberCount} 家供应商和型号规则合并到：
            </p>
            <select
              value={mergeTargetGroupId ?? ""}
              onChange={event => setMergeTargetGroupId(Number(event.target.value) || null)}
              className="mt-3 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-xs outline-none focus:border-[#185FA5]"
              autoFocus
            >
              <option value="">请选择目标分组</option>
              {groups.filter(group => group.id !== groupMerging.groupId).map(group => (
                <option key={group.id} value={group.id}>
                  {group.groupName}（{group.memberCount}家）
                </option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-gray-500">重复供应商自动去重；会话和聊天记录不会移动或删除。</p>
            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => { setGroupMerging(null); setMergeTargetGroupId(null); }}
                className="rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMergeGroup}
                disabled={!mergeTargetGroupId || mergeGroupsMut.isPending}
                className="rounded-md border-0 bg-[#185FA5] px-3.5 py-1.5 text-xs text-white hover:bg-[#0C447C] disabled:opacity-50"
              >
                {mergeGroupsMut.isPending ? "合并中…" : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 删除分组：进入30天回收站，不影响任何聊天记录 ── */}
      {groupTrashing && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="w-full max-w-[340px] rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">删除分组</h3>
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              「{groupTrashing.groupName}」将移至最近删除，30天内可恢复。
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              {groupTrashing.memberCount} 家供应商的一对一会话与聊天记录不会删除。
            </p>
            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setGroupTrashing(null)}
                className="rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleTrashGroup}
                disabled={trashGroupMut.isPending}
                className="rounded-md border-0 bg-[#185FA5] px-3.5 py-1.5 text-xs text-white hover:bg-[#0C447C] disabled:opacity-50"
              >
                {trashGroupMut.isPending ? "删除中…" : "删除分组"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 解散分组确认弹窗 ── */}
      {groupDissolving && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-[320px] shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">解散分组</h3>
            <p className="mt-2 text-xs text-gray-600 leading-relaxed">
              确定解散分组「{groupDissolving.groupName}」吗？
            </p>
            {/*
              明确说清影响范围。不写清的话用户会担心解散同时删掉
              供应商会话与聊天记录（采购聊天里常含报价与订单凭证），
              于是不敢点，最后留下一堆没用的分组。
            */}
            <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
              {groupDissolving.memberCount > 0
                ? `组内 ${groupDissolving.memberCount} 个会话将移出分组，`
                : "该分组当前没有会话，"}
              会话与聊天记录均不会删除。
            </p>
            <div className="flex gap-2.5 justify-end mt-4">
              <button
                onClick={() => setGroupDissolving(null)}
                className="px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-gray-500 cursor-pointer text-xs hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleDissolveGroup}
                disabled={dissolveGroupMut.isPending}
                className="px-3.5 py-1.5 border-none rounded-md bg-[#e64545] text-white cursor-pointer text-xs hover:bg-[#c93a3a] disabled:opacity-60"
              >
                {dissolveGroupMut.isPending ? "解散中…" : "确定解散"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 最近删除：30天内可恢复 ── */}
      {showGroupTrash && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="w-full max-w-[380px] rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Archive size={16} /> 最近删除
              </h3>
              <button type="button" onClick={() => setShowGroupTrash(false)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">分组保留30天；删除不会影响会话和聊天记录。</p>
            <div className="mt-3 max-h-[280px] space-y-1 overflow-y-auto">
              {trashedGroups.map(group => (
                <div key={group.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-gray-50">
                  <UsersRound size={15} className="shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{group.groupName}</span>
                  <button
                    type="button"
                    onClick={() => handleRestoreGroup(group.id)}
                    disabled={restoreGroupMut.isPending}
                    className="inline-flex items-center gap-1 border-0 bg-transparent text-[11px] text-[#185FA5] hover:underline disabled:opacity-50"
                  >
                    <ArchiveRestore size={13} /> 恢复
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 联系人备注名弹窗 ── */}
      {remarkEditor && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-[360px] shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">更改备注名字</h3>
            <p className="mt-1 text-[11px] text-gray-500 truncate" title={remarkEditor.originalName}>
              原名称：{remarkEditor.originalName}
            </p>
            <input
              value={remarkInput}
              onChange={(event) => setRemarkInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSaveRemark();
                if (event.key === "Escape") {
                  setRemarkEditor(null);
                  setRemarkInput("");
                }
              }}
              maxLength={64}
              placeholder="输入备注名字，留空可清除备注"
              className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
              autoFocus
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setRemarkInput("")}
                className="border-0 bg-transparent p-0 text-xs text-gray-500 hover:text-[#185FA5]"
              >
                清除备注
              </button>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setRemarkEditor(null);
                    setRemarkInput("");
                  }}
                  className="px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-gray-500 text-xs hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveRemark}
                  disabled={setRemarkNameMut.isPending}
                  className="px-3.5 py-1.5 border-0 rounded-md bg-[#185FA5] text-white text-xs hover:bg-[#0C447C] disabled:opacity-50"
                >
                  {setRemarkNameMut.isPending ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 报价单发送弹窗 ── */}
      <ContactProfileSheet
        target={contactProfileTarget}
        open={Boolean(contactProfileTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setContactProfileTarget(null);
        }}
        onBlockStateChange={setContactBlockState}
      />

      <ImageLightbox
        open={Boolean(imagePreview)}
        src={imagePreview?.src ?? null}
        alt={imagePreview?.alt ?? "聊天图片"}
        onOpenChange={open => {
          if (!open) setImagePreview(null);
        }}
        onRequestRefresh={imagePreview?.message.attachment?.id
          ? () => refreshChatPreviewImage(imagePreview.message)
          : undefined}
      />

      {showQuoteModal && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center">
          <div className="bg-white rounded-xl p-5 w-[calc(100vw-2rem)] max-w-[360px] shadow-xl">
            <h3 className="text-sm font-semibold mb-3.5 text-gray-900">💰 发送报价单</h3>
            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] text-gray-500 mb-0.5 block">型号 *</label>
                <input
                  value={quoteForm.partNumber}
                  onChange={(e) => setQuoteForm({ ...quoteForm, partNumber: e.target.value })}
                  placeholder="如 STM32F103C8T6"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-0.5 block">品牌 *</label>
                <input
                  value={quoteForm.brand}
                  onChange={(e) => setQuoteForm({ ...quoteForm, brand: e.target.value })}
                  placeholder="如 ST"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-gray-500 mb-0.5 block">数量 *</label>
                  <input
                    type="number"
                    value={quoteForm.qty}
                    onChange={(e) => setQuoteForm({ ...quoteForm, qty: e.target.value })}
                    placeholder="5000"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
                  />
                </div>
                <div className="w-[80px]">
                  <label className="text-[11px] text-gray-500 mb-0.5 block">单位</label>
                  <select
                    value={quoteForm.unit}
                    onChange={(e) => setQuoteForm({ ...quoteForm, unit: e.target.value })}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5] bg-white"
                  >
                    <option value="颗">颗</option>
                    <option value="片">片</option>
                    <option value="只">只</option>
                    <option value="个">个</option>
                    <option value="卷">卷</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-0.5 block">含税单价 (元) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={quoteForm.price}
                  onChange={(e) => setQuoteForm({ ...quoteForm, price: e.target.value })}
                  placeholder="6.50"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-[13px] outline-none focus:border-[#185FA5]"
                />
              </div>
            </div>
            <div className="flex gap-2.5 justify-end mt-4">
              <button
                onClick={() => {
                  setShowQuoteModal(false);
                  setQuoteForm({ partNumber: "", brand: "", qty: "", unit: "颗", price: "" });
                }}
                className="px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-gray-500 cursor-pointer text-xs hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!quoteForm.partNumber || !quoteForm.brand || !quoteForm.qty || !quoteForm.price || !activeConvId) return;
                  const content = JSON.stringify({
                    partNumber: quoteForm.partNumber,
                    brand: quoteForm.brand,
                    qty: Number(quoteForm.qty),
                    unit: quoteForm.unit,
                    price: Number(quoteForm.price),
                  });
                  const replyTo = messageReplyDescriptor(replyingTo);
                  // 先关弹窗再发：报价乐观上屏，失败时在气泡下方重试，
                  // 不需要让用户对着弹窗等待接口返回。
                  setShowQuoteModal(false);
                  setReplyingTo(null);
                  setQuoteForm({ partNumber: "", brand: "", qty: "", unit: "颗", price: "" });
                  submitMessage({
                    conversationId: activeConvId,
                    clientMessageId: createClientMessageId("quote"),
                    msgType: "quote",
                    content,
                    replyToMessageId: replyTo?.id,
                    replyTo,
                  });
                }}
                disabled={!quoteForm.partNumber || !quoteForm.brand || !quoteForm.qty || !quoteForm.price}
                className="px-3.5 py-1.5 border-none rounded-md bg-[#185FA5] text-white cursor-pointer text-xs hover:bg-[#0C447C] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                发送报价
              </button>
            </div>
          </div>
        </div>
      )}
      <MallLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}

function EnterpriseChatScopedProviders({
  accountId,
  enterpriseId,
  children,
}: {
  accountId: number;
  enterpriseId: number;
  children: ReactNode;
}) {
  const client = useMemo(() => createEnterpriseScopedTrpcClient({ enterpriseId }), [enterpriseId]);
  const queryClient = useMemo(() => new QueryClient(), [accountId, enterpriseId]);
  useEffect(
    () => installAuthSessionClearListener(() =>
      clearSessionQueryCache(queryClient, getQueryKey(trpc.auth.me, undefined, "query")),
    ),
    [queryClient],
  );
  useEffect(() => () => {
    // A late response under the former account/enterprise has nowhere to populate.
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

function InquiryEnterpriseSelectionGate({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <InquiryEnterpriseChooserDialog open={open} onOpenChange={onOpenChange} onSelect={() => onOpenChange(false)} />
      <main className="mx-auto mt-10 max-w-lg rounded-xl border border-[#dfe8f1] bg-white p-6 text-center shadow-sm" data-testid="chat-inquiry-enterprise-gate">
        <h1 className="text-lg font-semibold text-slate-800">请选择询价企业</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">询价必须以您明确选择的已开通企业发起。未选择、列表加载失败或没有可用企业时，不会发送询价。</p>
        <button type="button" className="mt-4 rounded-md bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0C447C]" onClick={() => onOpenChange(true)}>选择询价企业</button>
      </main>
    </>
  );
}

function InquiryEnterpriseMismatchGate() {
  return (
    <main className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm" data-testid="chat-inquiry-enterprise-mismatch">
      <h1 className="text-lg font-semibold text-amber-950">询价企业已变更</h1>
      <p className="mt-2 text-sm leading-6 text-amber-900">此询价链接绑定的买方企业与当前企业不一致。为避免跨企业发送或重试，请返回来源页后重新发起询价。</p>
    </main>
  );
}

function EnterpriseScopedChatPage({ user, loading }: Pick<ChatPageContentProps, "user" | "loading">) {
  const session = useEnterpriseSession();
  const searchStr = useSearch();
  const inquiryIntent = useMemo(() => parseSearchInquiry(new URLSearchParams(searchStr)), [searchStr]);
  const inquiryKey = inquiryIntent ? buildInquiryKey(inquiryIntent) : null;
  const [chooserOpen, setChooserOpen] = useState(true);
  useEffect(() => {
    setChooserOpen(true);
  }, [inquiryKey, user?.id]);

  // Root auth stays outside this boundary. Anonymous visitors retain the original login surface.
  if (!user) return <ChatPageContent user={user} loading={loading} enterpriseScopeId={null} />;
  if (loading || session.authLoading || session.accountId !== user.id || session.isLoading || session.isRestoringSelection) {
    return <ChatEnterpriseWait />;
  }
  if (session.error) {
    return inquiryIntent
      ? <InquiryEnterpriseSelectionGate open={chooserOpen} onOpenChange={setChooserOpen} />
      : <main className="mx-auto mt-10 max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700" role="alert">企业列表加载失败，暂不能加载聊天。</main>;
  }

  const active = session.activeEnterprise;
  const hasOperatingScope = isOperatingEnterprise(active ?? undefined);
  if (inquiryIntent) {
    const intendedEnterpriseId = inquiryIntent.inquiryEnterpriseId ?? null;
    // A bound source link must not silently adopt a different current company.
    if (intendedEnterpriseId && (!hasOperatingScope || active?.enterpriseId !== intendedEnterpriseId)) {
      return <InquiryEnterpriseMismatchGate />;
    }
    // Legacy links never consume an old claim or chat's automatic first-row fallback.
    if (!intendedEnterpriseId && (!hasOperatingScope || !session.hasExplicitSelection)) {
      return <InquiryEnterpriseSelectionGate open={chooserOpen} onOpenChange={setChooserOpen} />;
    }
  }

  if (hasOperatingScope && active) {
    return (
      <EnterpriseChatScopedProviders key={`chat:${user.id}:${active.enterpriseId}`} accountId={user.id} enterpriseId={active.enterpriseId}>
        <ChatPageContent user={user} loading={loading} enterpriseScopeId={active.enterpriseId} />
      </EnterpriseChatScopedProviders>
    );
  }
  // Personal accounts with no enterprise retain the legacy non-enterprise chat flow.
  if (session.items.length === 0) return <ChatPageContent user={user} loading={loading} enterpriseScopeId={null} />;
  return <InquiryEnterpriseSelectionGate open={chooserOpen} onOpenChange={setChooserOpen} />;
}

/** Root auth remains outside; reception mode deliberately retains its existing BFF surface. */
export default function ChatPage(props: ChatPageProps) {
  const { user, loading } = useAuth();
  if (props.businessReception !== undefined) {
    return <ChatPageContent {...props} user={user} loading={loading} enterpriseScopeId={null} />;
  }
  return <EnterpriseScopedChatPage user={user} loading={loading} />;
}

// ─── 消息气泡子组件 ───
function ErpInvitationCardBody({
  content,
  receptionMessage,
}: {
  content: string;
  receptionMessage?: string;
}) {
  const utils = trpc.useUtils();
  let card: {
    invitationId?: number;
    enterpriseName?: string;
    inviterName?: string;
    permissions?: Array<{ key?: string; label?: string }>;
    inventoryDataScope?: "own" | "enterprise";
    inventoryDataScopeLabel?: string;
    expiresAt?: string;
    status?: string;
  };
  try {
    card = JSON.parse(content);
  } catch {
    card = {};
  }
  const invitationId = Number(card.invitationId ?? 0);
  const myInvitations = trpc.enterprise.myInvitations.useQuery(undefined, {
    enabled: !receptionMessage && Number.isSafeInteger(invitationId) && invitationId > 0,
    retry: false,
  });
  const invitation = myInvitations.data?.find(item => item.id === invitationId);
  const status = invitation?.status ?? card.status ?? "pending";
  const permissionKeys: ErpPermissionKey[] = (card.permissions ?? [])
    .map(item => item.key ?? "")
    .filter(isErpPermissionKey);
  const acceptMutation = trpc.enterprise.acceptInvitation.useMutation({
    onSuccess: async () => {
      toast.success("已加入企业ERP");
      await Promise.all([
        utils.enterprise.myInvitations.invalidate(),
        utils.enterprise.me.invalidate(),
        utils.auth.me.invalidate(),
      ]);
    },
    onError: error => toast.error("接受邀请失败", { description: error.message }),
  });
  const rejectMutation = trpc.enterprise.rejectInvitation.useMutation({
    onSuccess: async () => {
      toast.success("已拒绝邀请");
      await utils.enterprise.myInvitations.invalidate();
    },
    onError: error => toast.error("拒绝邀请失败", { description: error.message }),
  });
  const pending = status === "pending";
  const busy = acceptMutation.isPending || rejectMutation.isPending;
  const actionRequestId = (prefix: string) => `${prefix}:${invitationId}:${Date.now()}`.slice(0, 64);

  return (
    <div className="w-[360px] max-w-full overflow-hidden rounded-xl border border-[#cfe0f2] bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#185FA5] to-[#2B7AE8] px-4 py-3 text-white">
        <div className="text-sm font-semibold">企业ERP成员邀请</div>
        <div className="mt-1 text-xs text-blue-100">由51小电送达</div>
      </div>
      <div className="space-y-3 p-4">
        <p className="m-0 text-sm leading-6 text-[#334455]">
          {card.inviterName || "企业管理员"} 邀请您加入
          <strong className="mx-1 text-[#185FA5]">{card.enterpriseName || "企业ERP"}</strong>
        </p>
        <div>
          <div className="mb-1 text-xs text-[#7a8998]">授予权限</div>
          <div className="flex flex-wrap gap-1.5">
            {permissionKeys.length > 0 ? permissionKeys.map(key => (
              <span key={key} className="rounded-full border border-[#d5e3f7] bg-[#eef4ff] px-2 py-0.5 text-[11px] text-[#185FA5]">
                {ERP_PERMISSION_DEFINITIONS[key].label}
              </span>
            )) : <span className="text-xs text-[#999]">权限信息暂不可用</span>}
          </div>
        </div>
        {card.inventoryDataScopeLabel || invitation?.inventoryDataScope ? (
          <p className="m-0 text-xs text-[#526273]">
            库存范围：{card.inventoryDataScopeLabel || (invitation?.inventoryDataScope === "enterprise" ? "全公司库存" : "仅本人负责库存")}
          </p>
        ) : null}
        {card.expiresAt ? <p className="m-0 text-[11px] text-[#999]">邀请自发送起24小时内有效 · 截止 {formatBeijingDateTime(card.expiresAt)}</p> : null}
        {receptionMessage ? (
          <div data-testid="business-reception-invitation-notice" role="status" className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs leading-5 text-amber-950">
            {receptionMessage}
          </div>
        ) : pending && invitationId > 0 ? (
          <div className="flex gap-2 border-t border-[#eef2f6] pt-3">
            <Button
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => acceptMutation.mutate({ invitationId, requestId: actionRequestId("accept") })}
            >同意加入</Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => rejectMutation.mutate({ invitationId, requestId: actionRequestId("reject") })}
            >拒绝</Button>
          </div>
        ) : (
          <div className="border-t border-[#eef2f6] pt-3 text-center text-xs font-medium text-[#667788]">
            {status === "accepted" ? "已同意并加入企业" : status === "rejected" ? "已拒绝" : status === "revoked" ? "邀请已撤销" : status === "expired" ? "邀请已过期" : "邀请状态不可用"}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageActionTarget({
  message,
  isMe,
  replyAuthor,
  onOpenMenu,
  children,
}: {
  message: Message;
  isMe: boolean;
  replyAuthor: string;
  onOpenMenu: (x: number, y: number) => void;
  children: ReactNode;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const actionable = typeof message.id === "number";

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const quoted = message.replyTo;
  let quotedSummary = "";
  if (quoted) {
    quotedSummary = quoted.unavailable || !quoted.msgType || quoted.content === null
      ? "原消息已撤回或删除"
      : compactMessageSummary({
          id: quoted.id,
          conversationId: message.conversationId,
          senderId: quoted.senderId ?? 0,
          msgType: quoted.msgType,
          content: quoted.content,
          createdAt: new Date(0),
        });
  }

  return (
    <div
      className="group/message relative"
      onContextMenu={event => {
        if (!actionable) return;
        event.preventDefault();
        onOpenMenu(event.clientX, event.clientY);
      }}
      onTouchStart={event => {
        if (!actionable || event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        longPressTriggeredRef.current = false;
        clearLongPress();
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTriggeredRef.current = true;
          onOpenMenu(touch.clientX, touch.clientY);
        }, 520);
      }}
      onTouchMove={event => {
        const origin = touchStartRef.current;
        const touch = event.touches[0];
        if (!origin || !touch) return;
        if (Math.abs(touch.clientX - origin.x) > 8 || Math.abs(touch.clientY - origin.y) > 8) {
          clearLongPress();
        }
      }}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
      onClickCapture={event => {
        if (!longPressTriggeredRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        longPressTriggeredRef.current = false;
      }}
    >
      {quoted && !message.recalledAt ? (
        <div className={`mb-1 flex ${isMe ? "justify-end pr-11" : "justify-start pl-11"}`}>
          <div
            data-testid="chat-message-reply-preview"
            className="max-w-[min(78%,420px)] truncate rounded-md border-l-2 border-[#8db8df] bg-[#edf4fa] px-2 py-1 text-[10px] text-[#60758a]"
            title={quotedSummary}
          >
            <span className="font-medium text-[#185FA5]">{replyAuthor}</span>
            <span className="mx-1">·</span>
            <span>{quotedSummary}</span>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function MessageActionButton({
  isMe,
  onOpenMenu,
}: {
  isMe: boolean;
  onOpenMenu?: (x: number, y: number) => void;
}) {
  if (!onOpenMenu) return null;
  return (
    <button
      type="button"
      data-testid="chat-message-action-trigger"
      aria-label="消息操作"
      title="更多操作"
      onClick={event => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu(isMe ? rect.left - 132 : rect.right + 4, rect.bottom + 3);
      }}
      className="hidden h-5 w-5 shrink-0 place-items-center self-center rounded border-0 bg-transparent p-0 text-gray-300 opacity-0 shadow-none transition-colors hover:bg-gray-200/70 hover:text-gray-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 group-hover/message:opacity-100 sm:grid"
    >
      <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

function MessageBubble({
  msg,
  isMe,
  myName,
  otherName,
  myAvatar,
  otherAvatar,
  peerLastReadMessageId,
  onRetry,
  onOpenImagePreview,
  onAvatarClick,
  onOpenMenu,
  businessReception,
}: {
  msg: Message;
  isMe: boolean;
  myName: string;
  otherName: string;
  /** 自己的头像；为空时回退首字母色块 */
  myAvatar?: string | null;
  /** 对方的头像；为空时回退首字母色块 */
  otherAvatar?: string | null;
  /** 对端最后读到的消息 ID，用于派生己方每条消息的已读状态。 */
  peerLastReadMessageId: number;
  /** 仅失败消息使用：点击后以原 clientMessageId 重发 */
  onRetry?: () => void;
  /** 聊天图片使用页面级灯箱预览，避免跳转到外部签名地址。 */
  onOpenImagePreview?: (message: Message) => void;
  /** 仅对方普通用户头像可点击查看联系人资料。 */
  onAvatarClick?: () => void;
  /** 桌面端气泡尾部的轻量菜单入口；移动端仍通过长按打开。 */
  onOpenMenu?: (x: number, y: number) => void;
  /** 仅后台接待镜像传入；普通前台页面不改变个人邀请功能。 */
  businessReception?: BusinessReceptionConfig;
}) {
  const avatarColor = isMe
    ? "bg-gradient-to-br from-[#2B7AE8] to-[#185FA5]"
    : "bg-gradient-to-br from-[#43a867] to-[#2d7a4f]";
  const initial = isMe ? getInitial(myName) : getInitial(otherName);
  const showCsAvatar = !isMe && isServiceName(otherName);

  /**
   * 发送状态标记，跟在时间戳后面。
   * 只有本地未确认的消息才带 deliveryState，已送达消息不显示任何额外文字。
   */
  const deliveryEl =
    msg.uploadState === "uploading" ? (
      <span className="ml-1 text-gray-400">· 上传中</span>
    ) : msg.deliveryState === "sending" ? (
      <span className="ml-1 text-gray-400">· 发送中</span>
    ) : msg.deliveryState === "failed" ? (
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 border-0 bg-transparent p-0 text-[9px] text-red-500 underline"
      >
        · 发送失败，点击重试
      </button>
    ) : isMe && typeof msg.id === "number" ? (
      <span className={msg.id <= peerLastReadMessageId ? "ml-1 text-[#5b83a8]" : "ml-1 text-gray-400"}>
        · {msg.id <= peerLastReadMessageId ? "已读" : "未读"}
      </span>
    ) : null;

  const avatarEl = showCsAvatar ? (
    <ServiceAvatar size="sm" />
  ) : (
    <UserAvatar
      avatarUrl={isMe ? myAvatar : otherAvatar}
      name={isMe ? myName : otherName}
      className="w-7 h-7 rounded-[7px] text-[11px]"
      fallbackClassName={avatarColor}
    />
  );
  const messageAvatarEl = !isMe && !showCsAvatar && onAvatarClick ? (
    <button
      type="button"
      onClick={onAvatarClick}
      className="shrink-0 rounded-[7px] border-0 bg-transparent p-0 transition hover:ring-2 hover:ring-[#185FA5]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185FA5]/40"
      aria-label={`查看${otherName}的联系人资料`}
      title="查看联系人资料"
    >
      {avatarEl}
    </button>
  ) : avatarEl;
  const actionButton = typeof msg.id === "number" ? (
    <MessageActionButton isMe={isMe} onOpenMenu={onOpenMenu} />
  ) : null;

  if (msg.recalledAt) {
    return (
      <div data-testid="chat-message-row" className="flex w-full justify-center px-1 py-0.5 sm:px-2">
        <span data-testid="chat-message-recalled" className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] text-gray-400">
          {isMe ? "你撤回了一条消息" : "对方撤回了一条消息"}
        </span>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "erp_invite") {
    return (
      <div data-testid="chat-message-row" className="flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2">
        {messageAvatarEl}
        <div data-testid="chat-message-content" className="flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col items-start sm:max-w-[420px]">
          <ErpInvitationCardBody
            content={msg.content}
            receptionMessage={businessReception?.personalFlowMessages["enterprise.myInvitations"]}
          />
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}{deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "company_like") {
    let card: {
      actorLabel?: string;
      actorCompanyName?: string | null;
      actorCompanySupplierId?: number | null;
      targetCompanyName?: string;
      likedAt?: string;
    };
    try {
      card = JSON.parse(msg.content);
    } catch {
      card = {};
    }
    const actorSupplierId = Number(card.actorCompanySupplierId ?? 0);
    const canOpenActorCompany = Boolean(
      card.actorCompanyName?.trim()
      && Number.isSafeInteger(actorSupplierId)
      && actorSupplierId > 0,
    );
    const actorName = card.actorCompanyName?.trim() || card.actorLabel?.trim() || "一位用户";
    return (
      <div data-testid="chat-message-row" className="flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2">
        {messageAvatarEl}
        <div data-testid="chat-message-content" className="flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col items-start sm:max-w-[420px]">
          <div data-testid="company-like-notification" className="w-[320px] max-w-full overflow-hidden rounded-xl border border-[#d9e7f5] bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-[#edf3f8] bg-[#f7fbff] px-3.5 py-2.5">
              <span aria-hidden className="text-base">👍</span>
              <span className="text-xs font-semibold text-[#185FA5]">公司主页获赞提醒</span>
            </div>
            <div className="space-y-2 px-3.5 py-3 text-xs leading-5 text-[#526273]">
              <p className="m-0">
                {canOpenActorCompany ? (
                  <Link
                    href={`/company/${actorSupplierId}`}
                    className="font-semibold text-[#185FA5] underline decoration-[#b9d2e8] underline-offset-2 hover:text-[#0C447C]"
                    title={`查看${actorName}的公司主页`}
                  >
                    {actorName}
                  </Link>
                ) : (
                  <strong className="text-[#334455]">{actorName}</strong>
                )}
                <span> 赞了您的公司主页</span>
              </p>
              {card.targetCompanyName ? (
                <p className="m-0 text-[11px] text-[#7a8998]">获赞公司：{card.targetCompanyName}</p>
              ) : null}
              {card.likedAt ? (
                <p className="m-0 text-[11px] text-[#9aa6b2]">点赞时间：{formatBeijingDateTime(card.likedAt)}</p>
              ) : null}
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}{deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "coffee_coupon") {
    let card: {
      assignmentId?: number;
      title?: string;
      text?: string;
      tips?: string[];
    };
    try {
      card = JSON.parse(msg.content);
    } catch {
      card = { text: "ERP开通礼已到账" };
    }
    const assignmentId = Number(card.assignmentId ?? 0);
    const imagePath = Number.isSafeInteger(assignmentId) && assignmentId > 0
      ? `/api/coffee-vouchers/${assignmentId}/image`
      : null;

    return (
      <div
        data-testid="chat-message-row"
        className="flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2"
      >
        {messageAvatarEl}
        <div
          data-testid="chat-message-content"
          className="flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col items-start sm:max-w-[360px]"
        >
          <div className="w-fit max-w-full overflow-hidden rounded-xl border border-[#cfe0f2] bg-white shadow-sm">
            <div className="flex items-center gap-2 bg-gradient-to-r from-[#185FA5] to-[#2B7AE8] px-3 py-2 text-white">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">51</span>
              <div>
                <div className="text-[11px] font-semibold">{card.title || "ERP开通礼｜瑞幸咖啡券"}</div>
                <div className="mt-0.5 text-[9px] text-blue-100">51小电专属发放</div>
              </div>
            </div>
            <div className="p-2.5">
              <p className="m-0 text-[11px] leading-relaxed text-gray-700">
                {card.text || "恭喜您成功开通51电子网ERP，赠送瑞幸咖啡券1张。"}
              </p>
              {imagePath ? (
                <a
                  href={imagePath}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block overflow-hidden rounded-lg border border-[#dce8f4] bg-[#f7faff]"
                  aria-label="放大查看瑞幸咖啡券海报"
                >
                  <img
                    src={imagePath}
                    alt="瑞幸咖啡券海报"
                    loading="lazy"
                    className="block h-auto max-h-[320px] w-full object-contain"
                    draggable={false}
                  />
                  <span className="block border-t border-[#e4edf6] bg-white px-2 py-1.5 text-center text-[10px] font-medium text-[#185FA5]">
                    点击海报放大扫码
                  </span>
                </a>
              ) : (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-center text-[10px] text-gray-400">
                  咖啡券图片暂不可用
                </div>
              )}
              {Array.isArray(card.tips) && card.tips.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {card.tips.slice(0, 3).map(tip => (
                    <span
                      key={tip}
                      className="rounded-full border border-[#d5e3f7] bg-[#eef4ff] px-2 py-0.5 text-[9px] text-[#185FA5]"
                    >
                      {tip}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "greeting") {
    let card: { title?: string; text?: string; tips?: string[] };
    try {
      card = JSON.parse(msg.content);
    } catch {
      card = { text: msg.content };
    }
    return (
      <div
        data-testid="chat-message-row"
        className="flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2"
      >
        {messageAvatarEl}
        <div
          data-testid="chat-message-content"
          className="flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col items-start sm:max-w-[420px]"
        >
          <div className="w-fit max-w-full bg-white border border-[#dbe7f5] rounded-[9px] overflow-hidden shadow-sm">
            <div className="px-2.5 py-1.5 bg-gradient-to-r from-[#2B7AE8] to-[#185FA5] text-white text-[11px] font-semibold flex items-center gap-1">
              <span>👋</span>
              <span>{card.title || "您好，我是51小电"}</span>
            </div>
            <div className="p-2.5">
              <div className="text-[11px] text-gray-700 leading-relaxed">{card.text}</div>
              {card.tips && card.tips.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {card.tips.map((tip) => (
                    <span
                      key={tip}
                      className="text-[10px] text-[#185FA5] bg-[#eef4ff] border border-[#d5e3f7] rounded-full px-2 py-0.5"
                    >
                      {tip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "sticker") {
    const sticker = getChatSticker(msg.content);
    return (
      <div
        data-testid="chat-message-row"
        className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
      >
        {messageAvatarEl}
        <div
          data-testid="chat-message-content"
          className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col ${isMe ? "items-end" : "items-start"}`}
        >
          {sticker ? (
            <img
              src={sticker.imageUrl}
              alt={sticker.label}
              loading="lazy"
              className={msg.content.startsWith("noto-") || msg.content.startsWith("emoji-")
                ? "h-24 w-24 object-contain"
                : msg.content.startsWith("yayatuan-")
                  ? "h-auto w-[120px] object-contain sm:w-[136px]"
                  : "h-auto w-[144px] rounded-xl object-cover shadow-sm sm:w-[176px]"}
              draggable={false}
            />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
              表情暂不可用
            </div>
          )}
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "image" || msg.msgType === "file") {
    const attachment = msg.attachment ?? null;
    const accessUrl = safeChatAttachmentUrl(attachment?.url);
    return (
      <div
        data-testid="chat-message-row"
        className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
      >
        {messageAvatarEl}
        <div
          data-testid="chat-message-content"
          className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col ${isMe ? "items-end" : "items-start"}`}
        >
          {msg.msgType === "image" ? (
            accessUrl ? (
              <button
                type="button"
                onClick={() => onOpenImagePreview?.(msg)}
                className="block max-w-[260px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:max-w-[340px]"
                aria-label={`查看图片 ${attachment?.originalName ?? "聊天图片"}`}
              >
                <img
                  src={accessUrl}
                  alt={attachment?.originalName ?? "聊天图片"}
                  loading="lazy"
                  className="block h-auto max-h-[420px] w-full object-contain"
                />
              </button>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
                图片暂不可用
              </div>
            )
          ) : accessUrl && attachment ? (
            <a
              href={accessUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={attachment.originalName}
              className="flex w-[260px] max-w-full items-center gap-3 rounded-xl border border-[#dbe7f5] bg-white p-3 text-left shadow-sm transition hover:border-[#8db8df] hover:bg-[#f7fbff]"
              aria-label={`下载文件 ${attachment.originalName}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8f1fa] text-[#185FA5]">
                <Paperclip className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-800">{attachment.originalName}</span>
                <span className="mt-1 block text-[10px] text-gray-400">{formatAttachmentBytes(attachment.byteSize)}</span>
              </span>
            </a>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
              文件暂不可用
            </div>
          )}
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "quote") {
    let quote: QuoteContent;
    try {
      quote = JSON.parse(msg.content);
    } catch {
      quote = { partNumber: "未知", brand: "未知", qty: 0, unit: "颗", price: 0 };
    }

    return (
      <div
      data-testid="chat-message-row"
      className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
    >
        {messageAvatarEl}
        <div
        data-testid="chat-message-content"
        className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col sm:max-w-[420px] ${isMe ? "items-end" : "items-start"}`}
      >
          <div className="w-fit max-w-full bg-white border border-[#e4e8f0] rounded-[9px] p-2.5 shadow-sm">
            <div className="text-[10px] text-[#2B7AE8] font-semibold mb-1.5">
              💰 {isMe ? "我方" : "对方"}报价
            </div>
            <div className="flex gap-2.5 mb-0.5">
              <span className="text-[11px] text-gray-600">
                型号：<b className="text-gray-900">{quote.partNumber}</b>
              </span>
              <span className="text-[11px] text-gray-600">
                品牌：<b className="text-gray-900">{quote.brand}</b>
              </span>
            </div>
            <div className="flex gap-2.5 mb-0.5">
              <span className="text-[11px] text-gray-600">
                数量：<b className="text-gray-900">{quote.qty.toLocaleString()} {quote.unit}</b>
              </span>
            </div>
            {/* 商家报价已为含税价（全站价格口径统一），不再叠加税额、不再展示双价对照 */}
            <div className="text-sm font-bold text-[#185FA5] mt-1.5">
              ¥{quote.price.toFixed(2)}/{quote.unit}{" "}
              <span className="text-[10px] font-normal text-gray-400">含税</span>
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "inquiry") {
    let card: {
      kind?: string;
      companyName?: string;
      partNumber?: string;
      brand?: string;
      pkg?: string;
      quantity?: string;
      requestedQty?: number | null;
      unit?: string;
      targetPrice?: string;
      remark?: string;
      threadNo?: string;
      totalItems?: number;
      items?: BomInquiryItem[];
      fileName?: string;
      fileUrl?: string;
      /* 买家身份与来源：由服务端写入，旧消息无此字段 */
      buyerName?: string;
      buyerCertified?: boolean;
      buyerTradeCount?: number;
      sourceLabel?: string;
      supplierQtyOnSale?: number;
    };
    try {
      card = JSON.parse(msg.content);
    } catch {
      card = { partNumber: msg.content };
    }

    // BOM 批量询价单：多行物料表格 + 询价 Excel 下载
    if (card.kind === "bom" && Array.isArray(card.items)) {
      const items = card.items;
      const fileHref = safeBomInquiryFileUrl(card.fileUrl);
      return (
        <div
          data-testid="chat-message-row"
          className={`flex min-w-0 items-end gap-1.5 ${isMe ? "flex-row-reverse" : ""}`}
        >
          {messageAvatarEl}
          <div
            data-testid="chat-message-content"
            className={`flex min-w-0 flex-col ${isMe ? "items-end" : "items-start"}`}
          >
            <div
              className="overflow-hidden rounded-[9px] border border-[#dbe7f5] bg-white shadow-sm"
              style={{ width: "min(720px, calc(100vw - 76px))", maxWidth: "100%" }}
            >
              <div className="flex items-center gap-1 bg-gradient-to-r from-[#2B7AE8] to-[#185FA5] px-2.5 py-1.5 text-[10px] font-semibold text-white">
                <span aria-hidden>▤</span>
                <span>BOM询价单 · {card.totalItems ?? items.length}项</span>
                {card.threadNo ? (
                  <span className="ml-auto font-normal opacity-80">{card.threadNo}</span>
                ) : null}
              </div>
              <div className="max-h-[360px] overflow-auto">
                <table className="min-w-[680px] w-full border-collapse text-[10px]">
                  <thead className="sticky top-0 bg-[#f2f7fb] text-[#53697c]">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">料号</th>
                      <th className="px-2 py-1.5 text-left font-semibold">品牌</th>
                      <th className="px-2 py-1.5 text-left font-semibold">封装</th>
                      <th className="px-2 py-1.5 text-right font-semibold">数量</th>
                      <th className="px-2 py-1.5 text-left font-semibold">价格库参考</th>
                      <th className="px-2 py-1.5 text-left font-semibold">位号</th>
                      <th className="px-2 py-1.5 text-left font-semibold">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr
                        key={`${item.excelRow}-${item.partNumber}-${index}`}
                        className="border-t border-gray-100 text-gray-600"
                      >
                        <td className="max-w-[150px] px-2 py-1.5 font-semibold text-[#185FA5] break-all">
                          {item.partNumber}
                        </td>
                        <td className="px-2 py-1.5">{item.brand || "—"}</td>
                        <td className="px-2 py-1.5">{item.pkg || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {Number(item.quantity ?? 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 font-semibold text-[#9f3c34]">
                          {item.referencePrice || item.aiPrice || "—"}
                        </td>
                        <td className="px-2 py-1.5">{item.reference || "—"}</td>
                        <td className="max-w-[160px] px-2 py-1.5 break-words">{item.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fileHref && card.fileName ? (
                <div className="border-t border-gray-200 px-2.5 py-2">
                  <a
                    href={fileHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-[#b9cee3] bg-[#eef5fc] px-2.5 py-1 text-[10px] font-semibold text-[#185FA5] no-underline hover:bg-[#e1eef9]"
                  >
                    下载询价Excel
                  </a>
                  <span className="ml-2 text-[9px] text-gray-400">{card.fileName}</span>
                </div>
              ) : null}
              <div className="border-t border-dashed border-gray-200 px-2.5 py-1.5 text-[9px] leading-relaxed text-gray-400">
                价格库参考仅用于采购寻源，不进入购物车或订单结算；最终价格以供应商报价为准。
              </div>
            </div>
            <span className="mt-0.5 px-0.5 text-[9px] text-gray-300">
              {formatMsgTime(msg.createdAt)}
              {deliveryEl}
            </span>
          </div>
          {actionButton}
        </div>
      );
    }

    const quantityText = card.requestedQty !== undefined
      ? inquiryQuantityText(card.requestedQty)
      : legacyInquiryQuantityText(card.quantity);
    const quantityPending = quantityText === "待确认";

    return (
      <div
      data-testid="chat-message-row"
      className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
    >
        {messageAvatarEl}
        <div
        data-testid="chat-message-content"
        className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col sm:max-w-[580px] ${isMe ? "items-end" : "items-start"}`}
      >
          <div className="w-full max-w-full overflow-hidden rounded-[9px] border border-[#dbe7f5] bg-white shadow-sm" style={{ width: "min(480px, calc(100vw - 76px))" }}>
            <div className="flex items-center border-b border-[#e5eef7] bg-[#f4f8fc] px-3 py-2 text-[10px] font-semibold text-[#185FA5]">
              <span>询价需求</span>
              {card.threadNo ? (
                <span className="ml-auto font-normal text-[#8296aa]">{card.threadNo}</span>
              ) : null}
            </div>
            <div className="px-3 pb-3 pt-2.5">
              <div className="break-all text-[15px] font-bold leading-5 text-[#183b59]">
                {card.partNumber || "-"}
              </div>
              {card.companyName || card.brand || card.pkg ? (
                <div className="mt-1 break-words text-[10px] leading-4 text-[#7b8b9a]">
                  {[
                    card.companyName ? `公司 ${card.companyName}` : "",
                    card.brand ? `品牌 ${card.brand}` : "",
                    card.pkg ? `封装 ${card.pkg}` : "",
                  ].filter(Boolean).join(" · ")}
                </div>
              ) : null}
              <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md border border-[#e6edf4] bg-[#f8fafc] px-2.5 py-2">
                <span className="shrink-0 text-[11px] text-[#5f7080]">询价数量</span>
                <span
                  className={quantityPending
                    ? "shrink-0 whitespace-nowrap rounded bg-[#fff1df] px-2 py-0.5 text-[11px] font-semibold text-[#b85c00]"
                    : "shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums text-[#185FA5]"}
                >
                  {quantityText}
                </span>
              </div>
              {card.targetPrice || card.remark ? (
                <div className="mt-2 text-[10px] leading-4 text-[#6f7e8c]">
                  {card.targetPrice ? <span>目标价 {card.targetPrice}</span> : null}
                  {card.targetPrice && card.remark ? <span> · </span> : null}
                  {card.remark ? <span>{card.remark}</span> : null}
                </div>
              ) : null}
            </div>
            {card.buyerName ? (
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-[#edf1f5] px-3 py-2 text-[10px]">
                <span className="font-semibold text-[#425466]">{card.buyerName}</span>
                {card.buyerCertified ? (
                  <span className="rounded-sm bg-[#EAF3DE] px-1 py-[1px] text-[9px] font-semibold text-[#3B6D11]">
                    已认证
                  </span>
                ) : null}
                {typeof card.buyerTradeCount === "number" && card.buyerTradeCount > 0 ? (
                  <span className="text-[#8a98a6]">累计完成交易 {card.buyerTradeCount.toLocaleString("zh-CN")} 笔</span>
                ) : null}
              </div>
            ) : null}
            {card.sourceLabel || (typeof card.supplierQtyOnSale === "number" && card.supplierQtyOnSale > 0) ? (
              <div className="border-t border-dashed border-[#e8edf2] bg-[#fbfcfd] px-3 py-1.5 text-[9px] leading-snug text-[#a0acb7]">
                {card.sourceLabel ? `来源：${card.sourceLabel}` : null}
                {card.sourceLabel && typeof card.supplierQtyOnSale === "number" && card.supplierQtyOnSale > 0 ? " · " : null}
                {typeof card.supplierQtyOnSale === "number" && card.supplierQtyOnSale > 0
                  ? `在售 ${card.supplierQtyOnSale.toLocaleString("zh-CN")}片`
                  : null}
              </div>
            ) : null}
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  if (msg.msgType === "handoff_notice") {
    let card: { partNumber?: string; quantity?: string; sourceInquiryId?: number; targetName?: string; nextConversationId?: number };
    try {
      card = JSON.parse(msg.content);
    } catch {
      card = {};
    }
    return (
      <div data-testid="chat-message-row" className="flex w-full min-w-0 shrink-0 box-border justify-center px-1 sm:px-2">
        <div data-testid="chat-message-content" className="flex min-w-0 max-w-full flex-col items-center sm:max-w-[420px]">
          <div className="w-fit max-w-full overflow-hidden rounded-[9px] border border-amber-200 bg-amber-50 shadow-sm">
            <div className="flex items-center gap-1 bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
              <span aria-hidden>↪</span><span>企业业务交接通知</span>
            </div>
            <div className="space-y-1 p-2.5 text-[11px] leading-relaxed text-amber-900">
              <p>{isMe ? "你的原询价已由供应商企业管理员更换接洽人。" : "原询价已由企业管理员转交给你，不代表采购方重新发起消息。"}</p>
              <p>料号：<b>{card.partNumber || "-"}</b>{card.quantity ? <> · 数量：<b>{card.quantity}</b></> : null}</p>
              {card.sourceInquiryId ? <p className="text-[10px] text-amber-700">原询价编号：{card.sourceInquiryId}</p> : null}
              {typeof card.targetName === "string" && card.targetName.trim() ? <p>接待人：<b>{card.targetName}</b></p> : null}
              {isMe && typeof card.targetName === "string" && card.targetName.trim() && Number.isSafeInteger(card.nextConversationId) && Number(card.nextConversationId) > 0 ? (
                <Link href={`/chat?conversationId=${card.nextConversationId}`} className="inline-flex text-[#185FA5] underline underline-offset-2">
                  联系新接待人
                </Link>
              ) : null}
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">{formatMsgTime(msg.createdAt)}</span>
        </div>
        {actionButton}
      </div>
    );
  }

  /*
   * 转账通知卡片（卖家直收订单由买家发给卖家；历史订单由 51小电发回执）。
   *
   * 本分支必须存在：服务端存的 content 是 JSON，
   * 一旦没有对应类型分支，会落到末尾的纯文本气泡里，
   * 买家看到的就是一大串 {"title":...} 原文。
   */
  if (msg.msgType === "transfer_notice") {
    let card: {
      title?: string;
      text?: string;
      orderNo?: string;
      amount?: string;
      payee?: string;
      items?: Array<{ partNumber: string; qty: number }>;
    };
    try {
      card = JSON.parse(msg.content);
    } catch {
      // 解析失败也不能把 JSON 扔给用户，退到一句可读提示
      card = { text: "订单对公转账已发起，请核实到账状态。" };
    }
    const noticeItems = Array.isArray(card.items) ? card.items.slice(0, 5) : [];
    const restCount = Array.isArray(card.items) ? card.items.length - noticeItems.length : 0;
    return (
      <div
        data-testid="chat-message-row"
        className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
      >
        {messageAvatarEl}
        <div
          data-testid="chat-message-content"
          className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col sm:max-w-[420px] ${isMe ? "items-end" : "items-start"}`}
        >
          <div className="w-fit max-w-full overflow-hidden rounded-[9px] border border-[#dbe7f5] bg-white shadow-sm">
            <div className="flex items-center gap-1 bg-gradient-to-r from-[#2B7AE8] to-[#185FA5] px-2.5 py-1.5 text-[11px] font-semibold text-white">
              <span aria-hidden>✓</span>
              <span>{card.title || "对公转账通知"}</span>
            </div>
            <div className="space-y-1 p-2.5">
              <div className="text-[11px] leading-relaxed text-gray-700">{card.text}</div>
              {card.orderNo ? (
                <div className="text-[11px] text-gray-600">
                  订单号：<b className="text-gray-900">{card.orderNo}</b>
                </div>
              ) : null}
              {card.amount ? (
                <div className="text-[11px] text-gray-600">
                  转账金额：<b className="text-[#185FA5]">¥{card.amount}</b>
                </div>
              ) : null}
              {noticeItems.length > 0 ? (
                <div className="text-[11px] text-gray-600">
                  型号数量：
                  <b className="text-gray-900">
                    {noticeItems
                      .map(it => `${it.partNumber} × ${Number(it.qty).toLocaleString("zh-CN")}`)
                      .join("；")}
                    {restCount > 0 ? ` 等 ${restCount} 项` : ""}
                  </b>
                </div>
              ) : null}
              {card.payee ? (
                <div className="text-[11px] text-gray-600">
                  收款方：<b className="text-gray-900">{card.payee}</b>
                </div>
              ) : null}
            </div>
          </div>
          <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
            {formatMsgTime(msg.createdAt)}
            {deliveryEl}
          </span>
        </div>
        {actionButton}
      </div>
    );
  }

  return (
    <div
      data-testid="chat-message-row"
      className={`flex w-full min-w-0 shrink-0 box-border items-end gap-2 px-1 sm:px-2 ${isMe ? "flex-row-reverse" : ""}`}
    >
      {messageAvatarEl}
      <div
        data-testid="chat-message-content"
        className={`flex min-w-0 max-w-[calc(100%_-_2.75rem)] flex-col sm:max-w-[420px] ${isMe ? "items-end" : "items-start"}`}
      >
        <div
          data-testid="chat-message-bubble"
          className={`w-fit max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-2.5 py-2 rounded-[10px] text-xs leading-relaxed ${
            isMe
              ? "bg-[#185FA5] text-white rounded-br-[3px]"
              : "bg-white text-gray-900 rounded-bl-[3px] shadow-sm"
          }`}
        >
          {msg.content}
        </div>
        <span className="mt-0.5 whitespace-nowrap px-0.5 text-[9px] text-gray-300">
          {formatMsgTime(msg.createdAt)}
          {deliveryEl}
        </span>
      </div>
      {actionButton}
    </div>
  );
}

function MessageMenuItem({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-xs hover:bg-gray-50 ${danger ? "text-red-600" : "text-gray-700"}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── 右键菜单项 ───
function CtxMenuItem({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`px-3.5 py-1.5 text-xs cursor-pointer flex items-center gap-1.5 hover:bg-gray-100 ${
        danger ? "text-red-600" : "text-gray-700"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

import type { CSSProperties } from "react";
import type { CompanyAvatarCrop } from "./companyPhotoImage";

/** A point in pixels relative to the crop frame. */
export type CompanyPhotoCropPoint = { x: number; y: number };

/**
 * Object-cover dimensions for one crop frame at a particular zoom level.
 * The saved offset controls only object-position's base overflow; after CSS
 * scale, `overflowX`/`overflowY` are the matching screen-pixel pan ranges.
 */
export type CompanyPhotoCropGeometry = {
  imageWidth: number;
  imageHeight: number;
  boxWidth: number;
  boxHeight: number;
  zoom: number;
  baseWidth: number;
  baseHeight: number;
  baseOverflowX: number;
  baseOverflowY: number;
  width: number;
  height: number;
  overflowX: number;
  overflowY: number;
};

export const COMPANY_PHOTO_CROP_MIN_ZOOM = 1;
export const COMPANY_PHOTO_CROP_MAX_ZOOM = 2;
export const COMPANY_PHOTO_CROP_MIN_OFFSET = -100;
export const COMPANY_PHOTO_CROP_MAX_OFFSET = 100;
export const DEFAULT_COMPANY_PHOTO_CROP: CompanyAvatarCrop = { zoom: 1, offsetX: 0, offsetY: 0 };

const EPSILON = 0.000001;

function finite(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

/** Clamp a numeric value without allowing NaN or infinity to pass through. */
export function clampCompanyPhotoCropNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback = minimum,
): number {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

/** Normalizes persisted/user supplied crop data to the existing API schema bounds. */
export function normalizeCompanyPhotoCrop(crop?: Partial<CompanyAvatarCrop> | null): CompanyAvatarCrop {
  return {
    zoom: clampCompanyPhotoCropNumber(
      crop?.zoom,
      COMPANY_PHOTO_CROP_MIN_ZOOM,
      COMPANY_PHOTO_CROP_MAX_ZOOM,
      DEFAULT_COMPANY_PHOTO_CROP.zoom,
    ),
    offsetX: clampCompanyPhotoCropNumber(
      crop?.offsetX,
      COMPANY_PHOTO_CROP_MIN_OFFSET,
      COMPANY_PHOTO_CROP_MAX_OFFSET,
      DEFAULT_COMPANY_PHOTO_CROP.offsetX,
    ),
    offsetY: clampCompanyPhotoCropNumber(
      crop?.offsetY,
      COMPANY_PHOTO_CROP_MIN_OFFSET,
      COMPANY_PHOTO_CROP_MAX_OFFSET,
      DEFAULT_COMPANY_PHOTO_CROP.offsetY,
    ),
  };
}

/**
 * Calculates object-cover dimensions before and after zoom. Invalid image/frame
 * dimensions deliberately report zero overflow, making interaction a safe no-op.
 */
export function getCompanyPhotoCropGeometry(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
  zoom = 1,
): CompanyPhotoCropGeometry {
  const safeImageWidth = Math.max(0, finite(imageWidth, 0));
  const safeImageHeight = Math.max(0, finite(imageHeight, 0));
  const safeBoxWidth = Math.max(0, finite(boxWidth, 0));
  const safeBoxHeight = Math.max(0, finite(boxHeight, 0));
  const safeZoom = clampCompanyPhotoCropNumber(
    zoom,
    COMPANY_PHOTO_CROP_MIN_ZOOM,
    COMPANY_PHOTO_CROP_MAX_ZOOM,
    1,
  );

  if (safeImageWidth <= EPSILON || safeImageHeight <= EPSILON || safeBoxWidth <= EPSILON || safeBoxHeight <= EPSILON) {
    return {
      imageWidth: safeImageWidth,
      imageHeight: safeImageHeight,
      boxWidth: safeBoxWidth,
      boxHeight: safeBoxHeight,
      zoom: safeZoom,
      baseWidth: 0,
      baseHeight: 0,
      baseOverflowX: 0,
      baseOverflowY: 0,
      width: 0,
      height: 0,
      overflowX: 0,
      overflowY: 0,
    };
  }

  const coverScale = Math.max(safeBoxWidth / safeImageWidth, safeBoxHeight / safeImageHeight);
  const baseWidth = safeImageWidth * coverScale;
  const baseHeight = safeImageHeight * coverScale;
  const baseOverflowX = Math.max(0, baseWidth - safeBoxWidth);
  const baseOverflowY = Math.max(0, baseHeight - safeBoxHeight);
  const width = baseWidth * safeZoom;
  const height = baseHeight * safeZoom;

  return {
    imageWidth: safeImageWidth,
    imageHeight: safeImageHeight,
    boxWidth: safeBoxWidth,
    boxHeight: safeBoxHeight,
    zoom: safeZoom,
    baseWidth,
    baseHeight,
    baseOverflowX,
    baseOverflowY,
    width,
    height,
    // Existing saved display semantics scale object-position movement too.
    overflowX: baseOverflowX * safeZoom,
    overflowY: baseOverflowY * safeZoom,
  };
}

/** Returns the same object-cover geometry at another zoom, preserving image/frame dimensions. */
export function companyPhotoCropGeometryAtZoom(
  geometry: CompanyPhotoCropGeometry,
  zoom: number,
): CompanyPhotoCropGeometry {
  return getCompanyPhotoCropGeometry(
    geometry.imageWidth,
    geometry.imageHeight,
    geometry.boxWidth,
    geometry.boxHeight,
    zoom,
  );
}

/**
 * Clamps to schema bounds and removes an axis' meaningless offset when
 * object-position has no base overflow. Under the established saved style an
 * equal-aspect image cannot pan merely by zooming; keeping it at zero avoids a
 * misleading drag that produces no expressible saved position.
 */
export function clampCompanyPhotoCrop(
  crop: Partial<CompanyAvatarCrop> | null | undefined,
  geometry?: CompanyPhotoCropGeometry,
): CompanyAvatarCrop {
  const normalized = normalizeCompanyPhotoCrop(crop);
  const cropGeometry = geometry
    ? companyPhotoCropGeometryAtZoom(geometry, normalized.zoom)
    : undefined;
  return {
    zoom: normalized.zoom,
    offsetX: cropGeometry && cropGeometry.baseOverflowX <= EPSILON ? 0 : normalized.offsetX,
    offsetY: cropGeometry && cropGeometry.baseOverflowY <= EPSILON ? 0 : normalized.offsetY,
  };
}

/**
 * CSS shared with existing public display surfaces. Do not add a translate:
 * persisted crops already use this object-position plus scale semantic.
 */
export function companyPhotoCropStyle(crop: CompanyAvatarCrop): CSSProperties {
  const { zoom, offsetX, offsetY } = normalizeCompanyPhotoCrop(crop);
  return {
    objectPosition: `${50 + offsetX / 2}% ${50 + offsetY / 2}%`,
    transform: `scale(${zoom})`,
    transformOrigin: "center",
  };
}

/**
 * Converts an on-frame screen point to the underlying object-cover pixel.
 * It intentionally mirrors the legacy object-position plus scale style.
 */
export function companyPhotoCropSourcePoint(
  crop: CompanyAvatarCrop,
  geometry: CompanyPhotoCropGeometry,
  point: CompanyPhotoCropPoint,
): CompanyPhotoCropPoint {
  const normalized = clampCompanyPhotoCrop(crop, geometry);
  const activeGeometry = companyPhotoCropGeometryAtZoom(geometry, normalized.zoom);
  const sourceAxis = (
    coordinate: number,
    boxSize: number,
    baseSize: number,
    baseOverflow: number,
    offset: number,
  ) => {
    if (boxSize <= EPSILON || baseSize <= EPSILON) return 0;
    const safeCoordinate = finite(coordinate, boxSize / 2);
    return (
      baseOverflow / 2
      + boxSize / 2
      + (safeCoordinate - boxSize / 2) / normalized.zoom
      + offset * baseOverflow / 200
    );
  };

  return {
    x: sourceAxis(point.x, activeGeometry.boxWidth, activeGeometry.baseWidth, activeGeometry.baseOverflowX, normalized.offsetX),
    y: sourceAxis(point.y, activeGeometry.boxHeight, activeGeometry.baseHeight, activeGeometry.baseOverflowY, normalized.offsetY),
  };
}

/**
 * Moves the rendered image by a screen-pixel delta. Positive delta means the
 * image is dragged right/down, so object-position offsets move negative.
 */
export function panCompanyPhotoCrop(
  crop: CompanyAvatarCrop,
  deltaX: number,
  deltaY: number,
  geometry: CompanyPhotoCropGeometry,
): CompanyAvatarCrop {
  const normalized = clampCompanyPhotoCrop(crop, geometry);
  const activeGeometry = companyPhotoCropGeometryAtZoom(geometry, normalized.zoom);
  const nextOffsetX = activeGeometry.overflowX > EPSILON
    ? normalized.offsetX - finite(deltaX, 0) * 200 / activeGeometry.overflowX
    : 0;
  const nextOffsetY = activeGeometry.overflowY > EPSILON
    ? normalized.offsetY - finite(deltaY, 0) * 200 / activeGeometry.overflowY
    : 0;
  return clampCompanyPhotoCrop({ ...normalized, offsetX: nextOffsetX, offsetY: nextOffsetY }, activeGeometry);
}

/**
 * Zooms while keeping the same source pixel under `fromPoint`/`toPoint`.
 * Supplying the same point for both gives wheel/slider anchor behavior;
 * different points gives pinch zoom plus two-finger panning.
 */
export function zoomCompanyPhotoCropAtPoints(
  crop: CompanyAvatarCrop,
  nextZoom: number,
  fromPoint: CompanyPhotoCropPoint,
  toPoint: CompanyPhotoCropPoint,
  geometry: CompanyPhotoCropGeometry,
): CompanyAvatarCrop {
  const normalized = clampCompanyPhotoCrop(crop, geometry);
  const targetZoom = clampCompanyPhotoCropNumber(
    nextZoom,
    COMPANY_PHOTO_CROP_MIN_ZOOM,
    COMPANY_PHOTO_CROP_MAX_ZOOM,
    normalized.zoom,
  );
  const targetGeometry = companyPhotoCropGeometryAtZoom(geometry, targetZoom);
  const sourcePoint = companyPhotoCropSourcePoint(normalized, geometry, fromPoint);

  const offsetForAxis = (
    source: number,
    targetCoordinate: number,
    boxSize: number,
    baseSize: number,
    baseOverflow: number,
  ) => {
    if (boxSize <= EPSILON || baseSize <= EPSILON || baseOverflow <= EPSILON) return 0;
    const safeTarget = finite(targetCoordinate, boxSize / 2);
    const fixedSource = baseOverflow / 2 + boxSize / 2 + (safeTarget - boxSize / 2) / targetZoom;
    return (source - fixedSource) * 200 / baseOverflow;
  };

  return clampCompanyPhotoCrop({
    zoom: targetZoom,
    offsetX: offsetForAxis(
      sourcePoint.x,
      toPoint.x,
      targetGeometry.boxWidth,
      targetGeometry.baseWidth,
      targetGeometry.baseOverflowX,
    ),
    offsetY: offsetForAxis(
      sourcePoint.y,
      toPoint.y,
      targetGeometry.boxHeight,
      targetGeometry.baseHeight,
      targetGeometry.baseOverflowY,
    ),
  }, targetGeometry);
}

/** Zooms around one fixed point, for mouse wheel and the zoom range input. */
export function zoomCompanyPhotoCropAtPoint(
  crop: CompanyAvatarCrop,
  nextZoom: number,
  anchor: CompanyPhotoCropPoint,
  geometry: CompanyPhotoCropGeometry,
): CompanyAvatarCrop {
  return zoomCompanyPhotoCropAtPoints(crop, nextZoom, anchor, anchor, geometry);
}

/** Pure two-pointer gesture helper: scale and midpoint movement in one operation. */
export function pinchCompanyPhotoCrop(
  crop: CompanyAvatarCrop,
  startFirst: CompanyPhotoCropPoint,
  startSecond: CompanyPhotoCropPoint,
  currentFirst: CompanyPhotoCropPoint,
  currentSecond: CompanyPhotoCropPoint,
  geometry: CompanyPhotoCropGeometry,
): CompanyAvatarCrop {
  const startDistance = Math.hypot(startSecond.x - startFirst.x, startSecond.y - startFirst.y);
  const currentDistance = Math.hypot(currentSecond.x - currentFirst.x, currentSecond.y - currentFirst.y);
  const scale = startDistance > EPSILON && Number.isFinite(currentDistance)
    ? currentDistance / startDistance
    : 1;
  const startCenter = {
    x: (startFirst.x + startSecond.x) / 2,
    y: (startFirst.y + startSecond.y) / 2,
  };
  const currentCenter = {
    x: (currentFirst.x + currentSecond.x) / 2,
    y: (currentFirst.y + currentSecond.y) / 2,
  };
  return zoomCompanyPhotoCropAtPoints(crop, crop.zoom * scale, startCenter, currentCenter, geometry);
}

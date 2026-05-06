import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Skeleton } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import DialogImage from './DialogImage';
import { cn } from '~/utils';

/** Max display height for chat images (Tailwind JIT class) */
export const IMAGE_MAX_H = 'max-h-[45vh]' as const;
/** Matches the `max-w-lg` Tailwind class on the wrapper button (32rem = 512px at 16px base) */
const IMAGE_MAX_W_PX = 512;

function sanitizeImagePath(imagePath: string): string {
  if (!imagePath) return '';
  if (imagePath.startsWith('blob:')) return imagePath;
  if (imagePath.startsWith('data:image/')) return imagePath;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  if (imagePath.startsWith('/')) return imagePath;
  return '';
}

function getSafeDownloadHref(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/** Caches image dimensions by src so remounts can reserve space */
const dimensionCache = new Map<string, { width: number; height: number }>();
/** Tracks URLs that have been fully painted — skip skeleton on remount */
const paintedUrls = new Set<string>();

/** Test-only: resets module-level caches */
export function _resetImageCaches(): void {
  dimensionCache.clear();
  paintedUrls.clear();
}

function computeHeightStyle(w: number, h: number): React.CSSProperties {
  return { height: `min(45vh, ${(h / w) * 100}vw, ${(h / w) * IMAGE_MAX_W_PX}px)` };
}

const Image = ({
  imagePath,
  altText,
  className,
  args,
  width,
  height,
}: {
  imagePath: string;
  altText: string;
  className?: string;
  args?: {
    prompt?: string;
    quality?: 'low' | 'medium' | 'high';
    size?: string;
    style?: string;
    [key: string]: unknown;
  };
  width?: number;
  height?: number;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const absoluteImageUrl = useMemo(() => {
    const safeImagePath = sanitizeImagePath(imagePath);
    if (!safeImagePath) return '';

    if (
      safeImagePath.startsWith('blob:') ||
      safeImagePath.startsWith('http://') ||
      safeImagePath.startsWith('https://') ||
      safeImagePath.startsWith('data:image/') ||
      !safeImagePath.startsWith('/images/')
    ) {
      return safeImagePath;
    }

    const baseURL = apiBaseUrl();
    return `${baseURL}${safeImagePath}`;
  }, [imagePath]);

  const downloadImage = async () => {
    try {
      const response = await fetch(absoluteImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      const safeHref = getSafeDownloadHref(absoluteImageUrl);
      if (!safeHref) {
        console.warn('Blocked unsafe download URL');
        return;
      }
      const link = document.createElement('a');
      link.href = safeHref;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    if (width && height && absoluteImageUrl) {
      dimensionCache.set(absoluteImageUrl, { width, height });
    }
  }, [absoluteImageUrl, width, height]);

  const dims = width && height ? { width, height } : dimensionCache.get(absoluteImageUrl);
  const hasDimensions = !!(dims?.width && dims?.height);
  const heightStyle = hasDimensions ? computeHeightStyle(dims.width, dims.height) : undefined;
  const showSkeleton = hasDimensions && !paintedUrls.has(absoluteImageUrl);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`View ${altText} in dialog`}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
        className={cn(
          'relative mt-1 w-full max-w-lg cursor-pointer overflow-hidden rounded-lg border border-border-light text-text-secondary-alt shadow-md transition-shadow',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary',
          className,
        )}
        style={heightStyle}
      >
        {showSkeleton && <Skeleton className="absolute inset-0" aria-hidden="true" />}
        <img
          alt={altText}
          src={absoluteImageUrl}
          onLoad={() => paintedUrls.add(absoluteImageUrl)}
          className={cn(
            'relative block text-transparent',
            hasDimensions
              ? 'size-full object-contain'
              : cn('h-auto w-auto max-w-full', IMAGE_MAX_H),
          )}
        />
      </button>
      <DialogImage
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={absoluteImageUrl}
        downloadImage={downloadImage}
        args={args}
        triggerRef={triggerRef}
      />
    </div>
  );
};

export default Image;

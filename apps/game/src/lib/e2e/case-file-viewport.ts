export type CssViewportSize = {
  width: number;
  height: number;
};

export const CASE_FILE_PREFERRED_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

export function validDevicePixelRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function caseFileViewportNativeSize(
  devicePixelRatio: number,
  cssViewport: CssViewportSize = CASE_FILE_PREFERRED_VIEWPORT,
): CssViewportSize {
  const scale = validDevicePixelRatio(devicePixelRatio);
  return {
    width: Math.ceil(cssViewport.width * scale),
    height: Math.ceil(cssViewport.height * scale),
  };
}

export function meetsCaseFileViewportTarget(
  viewport: CssViewportSize,
): boolean {
  return (
    viewport.width >= CASE_FILE_PREFERRED_VIEWPORT.width &&
    viewport.height >= CASE_FILE_PREFERRED_VIEWPORT.height
  );
}

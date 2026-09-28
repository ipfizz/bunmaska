import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

const GDIPLUS_SYMBOLS = {
  // (ULONG_PTR* token, GdiplusStartupInput* input, GdiplusStartupOutput* output) -> Status
  GdiplusStartup: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  // (IStream*, GpImage** out) -> Status
  GdipLoadImageFromStream: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpImage*, GpImage** out) -> Status
  GdipCloneImage: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpImage*) -> Status
  GdipDisposeImage: { args: [FFIType.u64], returns: FFIType.i32 },
  // (GpImage*, UINT* out) -> Status
  GdipGetImageWidth: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpImage*, UINT* out) -> Status
  GdipGetImageHeight: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpImage*, IStream*, const CLSID* encoder, EncoderParameters*) -> Status
  GdipSaveImageToStream: {
    args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (INT w, INT h, INT stride, PixelFormat, BYTE* scan0, GpBitmap** out) -> Status
  GdipCreateBitmapFromScan0: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (GpImage*, GpGraphics** out) -> Status
  GdipGetImageGraphicsContext: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpGraphics*, InterpolationMode) -> Status
  GdipSetInterpolationMode: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i32 },
  // (GpGraphics*, GpImage*, INT x, INT y, INT w, INT h) -> Status: draw scaled into the rect
  GdipDrawImageRectI: {
    args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  // (GpGraphics*) -> Status
  GdipDeleteGraphics: { args: [FFIType.u64], returns: FFIType.i32 },
  // (INT x, INT y, INT w, INT h, PixelFormat, GpBitmap* src, GpBitmap** out) -> Status
  GdipCloneBitmapAreaI: {
    args: [
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.u64,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  // (const BITMAPINFO* gdiBitmapInfo, void* gdiBitmapData, GpBitmap** out) -> Status: the
  // bitmap reads gdiBitmapData in place, so it must outlive the bitmap.
  GdipCreateBitmapFromGdiDib: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (GpBitmap*, const GpRect* rect, UINT flags, PixelFormat, BitmapData* out) -> Status
  GdipBitmapLockBits: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (GpBitmap*, BitmapData*) -> Status
  GdipBitmapUnlockBits: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (GpBitmap*, HICON* out) -> Status: the caller owns the icon (DestroyIcon)
  GdipCreateHICONFromBitmap: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
} as const;

export const GDIP_OK = 0;
export const IMAGE_LOCK_MODE_READ = 1;
export const PIXEL_FORMAT_32BPP_ARGB = 0x0026200a;
export const INTERPOLATION_HIGH_QUALITY_BICUBIC = 7;

/** GDI+ image-encoder CLSIDs (GUID bytes, little-endian for the first three fields). */
export const PNG_ENCODER_CLSID = new Uint8Array([
  0x06, 0xf4, 0x7c, 0x55, 0x04, 0x1a, 0xd3, 0x11, 0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e,
]);
export const JPEG_ENCODER_CLSID = new Uint8Array([
  0x01, 0xf4, 0x7c, 0x55, 0x04, 0x1a, 0xd3, 0x11, 0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e,
]);

/** Open gdiplus.dll and return its symbol table. Memoised; Windows-only. */
export const loadGdiplus = winLibraryAccessor('gdiplus', () =>
  dlopen('gdiplus.dll', GDIPLUS_SYMBOLS),
);

const SHLWAPI_SYMBOLS = {
  // (const BYTE* pInit, UINT cbInit) -> IStream* over a COPY of the bytes
  SHCreateMemStream: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
} as const;

/** Open shlwapi.dll and return its symbol table. Memoised; Windows-only. */
export const loadShlwapi = winLibraryAccessor('shlwapi', () =>
  dlopen('shlwapi.dll', SHLWAPI_SYMBOLS),
);

import { ptr } from 'bun:ffi';
import { expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  KCG_ALPHA_PREMULTIPLIED_LAST,
  loadCoreGraphicsImageFFI,
} from '../../../src/main/platform/macos/core-graphics-image-ffi';

test.skipIf(currentPlatform() !== 'macos')(
  'CGContextDrawImage draws into the CGRect it was given (D018)',
  () => {
    const cg = loadCoreGraphicsImageFFI().symbols;
    const colorSpace = cg.CGColorSpaceCreateDeviceRGB();
    const context = (pixels: Uint8Array, width: number) =>
      cg.CGBitmapContextCreate(
        ptr(pixels),
        BigInt(width),
        1n,
        8n,
        BigInt(width * 4),
        colorSpace,
        KCG_ALPHA_PREMULTIPLIED_LAST,
      );

    const red = new Uint8Array([255, 0, 0, 255]);
    const source = context(red, 1);
    const image = cg.CGBitmapContextCreateImage(source);
    const target = new Uint8Array(8);
    const destination = context(target, 2);

    cg.CGContextDrawImage(destination, 1, 0, 1, 1, image);

    expect([...target]).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
    cg.CGImageRelease(image);
    cg.CGContextRelease(source);
    cg.CGContextRelease(destination);
    cg.CGColorSpaceRelease(colorSpace);
  },
);

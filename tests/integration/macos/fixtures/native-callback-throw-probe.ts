/**
 * Probe: IMPs and Blocks whose JS throws. Runs in its own process because the
 * rethrown errors are uncaught by design. Prints one JSON line.
 */
import { FFIType } from 'bun:ffi';
import { makeOneShotBlock } from '../../../../src/main/platform/macos/cocoa-block';
import { nsString } from '../../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendPtr,
  msgSendReturnsU8,
} from '../../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../../src/main/platform/macos/cocoa-runtime';
import { defineObjcClass } from '../../../../src/main/platform/macos/cocoa-runtime-class';

const uncaught: string[] = [];
process.on('uncaughtException', (error) => {
  uncaught.push(error.message);
});

const escaped: string[] = [];
const native = <T>(label: string, call: () => T): T | undefined => {
  try {
    return call();
  } catch {
    escaped.push(label);
    return undefined;
  }
};

const rt = cocoa();
const sel = (name: string): bigint => rt.selectors.get(name);
let voidCalls = 0;
const cls = defineObjcClass('BunmaskaThrowProbe', 'NSObject', [
  {
    selector: 'probeVoid',
    typeEncoding: 'v@:',
    args: [],
    impl: () => {
      voidCalls += 1;
      throw new Error(`void ${voidCalls}`);
    },
  },
  {
    selector: 'probeBool',
    typeEncoding: 'c@:',
    args: [],
    returns: 'bool',
    impl: () => {
      throw new Error('bool');
    },
  },
  {
    selector: 'probeObject',
    typeEncoding: '@@:',
    args: [],
    returns: 'object',
    impl: () => {
      throw new Error('object');
    },
  },
]);

const instances = rt.msgSend(rt.classes.get('NSMutableArray'), sel('new'));
for (let i = 0; i < 2; i += 1) {
  msgSendPtr(instances, sel('addObject:'), rt.msgSend(rt.msgSend(cls, sel('alloc')), sel('init')));
}
const instance = msgSendPtr(instances, sel('objectAtIndex:'), 0n);

native('void', () => msgSendPtr(instances, sel('makeObjectsPerformSelector:'), sel('probeVoid')));
const boolResult = native('bool', () => msgSendReturnsU8(instance, sel('probeBool')));
const objectResult = native('object', () => rt.msgSend(instance, sel('probeObject')));

const one = msgSendPtr(rt.classes.get('NSArray'), sel('arrayWithObject:'), nsString('x'));
const block = makeOneShotBlock(() => {
  throw new Error('block');
}, [FFIType.u64, FFIType.u64, FFIType.ptr]);
native('block', () => msgSendPtr(one, sel('enumerateObjectsUsingBlock:'), block));

setTimeout(() => {
  process.stdout.write(
    `${JSON.stringify({ voidCalls, boolResult, objectResult: String(objectResult), escaped, uncaught })}\n`,
  );
  process.exit(0);
}, 50);

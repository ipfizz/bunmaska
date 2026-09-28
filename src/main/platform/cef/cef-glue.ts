import { cc, FFIType, type Pointer } from 'bun:ffi';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The C half of the CEF client, compiled in-process by Bun's TinyCC (`cc`, D048): no
 * prebuilt binary ships in the package. CEF calls refcounting, some getters
 * (`get_browser_process_handler` "on multiple threads") and the pump scheduler from
 * threads a synchronous JSCallback must never run on, so those are C. Every object
 * bunmaska hands CEF is immortal: refcounting is a no-op, and a getter returns the
 * pointer stored in a trailing slot found via the struct's own `size`.
 *
 * The scheduler wakes the macOS drain with a signaled version-0 run-loop source, never
 * CFRunLoopStop: a stop that lands while Bun runs JS (outside CFRunLoopRunInMode) is
 * dropped by the next run, and the work then waits for the pump's idle timeout.
 */
const GLUE_SOURCE = `#include <stdint.h>
typedef struct { uint64_t size; void* add_ref; void* release; void* has_one_ref; void* has_at_least_one_ref; } bm_base;
static void bm_add_ref(void* s) { (void)s; }
static int bm_release(void* s) { (void)s; return 0; }
static int bm_has_one_ref(void* s) { (void)s; return 0; }
static int bm_has_at_least_one_ref(void* s) { (void)s; return 1; }
void bm_init_base(void* p, uint64_t size) {
  bm_base* b = (bm_base*)p;
  b->size = size;
  b->add_ref = (void*)bm_add_ref;
  b->release = (void*)bm_release;
  b->has_one_ref = (void*)bm_has_one_ref;
  b->has_at_least_one_ref = (void*)bm_has_at_least_one_ref;
}
#define BM_SLOT(i) static void* bm_slot##i(void* s) { return *(void**)((char*)s + ((bm_base*)s)->size + 8 * (i)); }
BM_SLOT(0) BM_SLOT(1) BM_SLOT(2) BM_SLOT(3) BM_SLOT(4) BM_SLOT(5) BM_SLOT(6) BM_SLOT(7)
void* bm_slot_getter(int i) {
  switch (i) {
    case 0: return (void*)bm_slot0; case 1: return (void*)bm_slot1;
    case 2: return (void*)bm_slot2; case 3: return (void*)bm_slot3;
    case 4: return (void*)bm_slot4; case 5: return (void*)bm_slot5;
    case 6: return (void*)bm_slot6; default: return (void*)bm_slot7;
  }
}
typedef struct {
  int64_t version; void* info; void* retain; void* release; void* copy_description;
  void* equal; void* hash; void* schedule; void* cancel; void* perform;
} bm_source_context;
extern void* CFRunLoopGetMain(void);
extern void CFRunLoopWakeUp(void* rl);
extern double CFAbsoluteTimeGetCurrent(void);
extern void* CFRunLoopSourceCreate(void* allocator, int64_t order, bm_source_context* context);
extern void CFRunLoopSourceSignal(void* source);
extern void CFRunLoopAddSource(void* rl, void* source, void* mode);
extern void* CFRunLoopTimerCreate(void* a, double fire, double interval, uint64_t flags, int64_t order, void* cb, void* ctx);
extern void CFRunLoopTimerSetNextFireDate(void* timer, double fire);
extern void CFRunLoopAddTimer(void* rl, void* timer, void* mode);
extern void* kCFRunLoopCommonModes;
static void* bm_source = 0;
static void* bm_timer = 0;
static void bm_perform(void* info) { (void)info; }
static void bm_wake(void) { CFRunLoopSourceSignal(bm_source); CFRunLoopWakeUp(CFRunLoopGetMain()); }
static void bm_fire(void* timer, void* info) { (void)timer; (void)info; bm_wake(); }
void bm_pump_init(void) {
  bm_source_context context = {0};
  context.perform = (void*)bm_perform;
  bm_source = CFRunLoopSourceCreate(0, 0, &context);
  CFRunLoopAddSource(CFRunLoopGetMain(), bm_source, kCFRunLoopCommonModes);
  bm_timer = CFRunLoopTimerCreate(0, CFAbsoluteTimeGetCurrent() + 1e9, 1e9, 0, 0, (void*)bm_fire, 0);
  CFRunLoopAddTimer(CFRunLoopGetMain(), bm_timer, kCFRunLoopCommonModes);
}
static void bm_schedule(void* self, int64_t delay_ms) {
  (void)self;
  if (delay_ms <= 0) { bm_wake(); return; }
  CFRunLoopTimerSetNextFireDate(bm_timer, CFAbsoluteTimeGetCurrent() + (double)delay_ms / 1000.0);
}
void* bm_schedule_fn(void) { return (void*)bm_schedule; }
`;

const SYMBOLS = {
  bm_init_base: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
  bm_slot_getter: { args: [FFIType.i32], returns: FFIType.ptr },
  bm_pump_init: { args: [], returns: FFIType.void },
  bm_schedule_fn: { args: [], returns: FFIType.ptr },
} as const;

export type CefGlue = {
  /** Fill a CEF struct's `cef_base_ref_counted_t` header as an immortal object. */
  readonly initBase: (struct: Pointer, size: number) => void;
  /** A getter returning trailing slot `index` of whatever struct it is installed in. */
  readonly slotGetter: (index: number) => number;
  /** Add the wakeup source and timer to the main run loop; main thread, before `cef_initialize`. */
  readonly pumpInit: () => void;
  /** `on_schedule_message_pump_work`: wakes the adaptive pump from any thread. */
  readonly scheduleFn: () => number;
};

let cached: CefGlue | undefined;

/** Compile the glue once per process (TinyCC needs a source file on disk). */
export const cefGlue = (): CefGlue => {
  if (cached !== undefined) {
    return cached;
  }
  const hash = createHash('sha256').update(GLUE_SOURCE).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), 'bunmaska-cef');
  mkdirSync(dir, { recursive: true });
  const source = join(dir, `glue-${hash}.c`);
  writeFileSync(source, GLUE_SOURCE);
  const lib = cc({ source, symbols: SYMBOLS });
  const toNumber = (value: unknown): number => Number(value ?? 0);
  cached = {
    initBase: (struct, size) => lib.symbols.bm_init_base(struct, BigInt(size)),
    slotGetter: (index) => toNumber(lib.symbols.bm_slot_getter(index)),
    pumpInit: () => lib.symbols.bm_pump_init(),
    scheduleFn: () => toNumber(lib.symbols.bm_schedule_fn()),
  };
  return cached;
};

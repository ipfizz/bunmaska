/* The generic CEF subprocess (renderer, GPU, utility) shipped inside a Blink
 * engine. It loads the framework next to its own .app and hands the process to
 * CEF; every app on the machine shares it. Build: see build-cef-engine.ts. */
#include <dlfcn.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <pthread.h>
#include <sys/event.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef BM_CEF_API_VERSION
#error "build with -DBM_CEF_API_VERSION=<the version cef-ffi.ts pins>"
#endif

typedef struct {
  int argc;
  char** argv;
} cef_main_args_t;
typedef const char* (*api_hash_fn)(int, int);
typedef int (*execute_fn)(const cef_main_args_t*, void*, void*);

/* A child can outlive a SIGKILLed app while holding its stdio; exit with the parent pid. */
static void* exit_with_parent(void* arg) {
  pid_t parent = (pid_t)(intptr_t)arg;
  int kq = kqueue();
  struct kevent change;
  EV_SET(&change, parent, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  struct kevent event;
  if (kq >= 0 && kevent(kq, &change, 1, &event, 1, NULL) > 0) _exit(0);
  return NULL;
}

/* <lib>/<name> Helper.app/Contents/MacOS/<exe>: four levels up is <lib>. */
int main(int argc, char** argv) {
  pthread_t watcher;
  if (pthread_create(&watcher, NULL, exit_with_parent, (void*)(intptr_t)getppid()) == 0) {
    pthread_detach(watcher);
  }
  char exe[PATH_MAX], lib[PATH_MAX], path[PATH_MAX * 2];
  uint32_t size = sizeof exe;
  if (_NSGetExecutablePath(exe, &size) != 0 || realpath(exe, lib) == NULL) return 70;
  for (int i = 0; i < 4; i++) {
    char* slash = strrchr(lib, '/');
    if (slash == NULL) return 71;
    *slash = '\0';
  }
  snprintf(path, sizeof path, "%s/Chromium Embedded Framework.framework/Chromium Embedded Framework", lib);
  void* handle = dlopen(path, RTLD_LAZY | RTLD_LOCAL | RTLD_FIRST);
  if (handle == NULL) {
    fprintf(stderr, "bunmaska helper: %s\n", dlerror());
    return 72;
  }
  api_hash_fn api_hash = (api_hash_fn)dlsym(handle, "cef_api_hash");
  execute_fn execute = (execute_fn)dlsym(handle, "cef_execute_process");
  if (api_hash == NULL || execute == NULL) return 73;
  api_hash(BM_CEF_API_VERSION, 0);
  cef_main_args_t args = {argc, argv};
  return execute(&args, NULL, NULL);
}

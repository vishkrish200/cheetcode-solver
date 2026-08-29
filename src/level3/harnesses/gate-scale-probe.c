#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>
typedef void (*rst)(void); typedef int (*reg)(int);
typedef int (*att)(int,int,int,int64_t,int64_t); typedef int (*rol)(int,int,int);
typedef int (*adm)(int,int,int64_t);
static rst R; static reg G; static att A; static rol O; static adm D;
static double sec(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec + t.tv_nsec/1e9; }
static double run(int n,int reps){
  R();
  for(int i=1;i<=n;++i){ G(i); O(i,10,1); A(i,10,1,100,1000000); }
  double t0=sec(); volatile long s=0;
  for(int r=0;r<reps;++r) for(int i=1;i<=n;++i) s+=D(i,10,200);
  (void)s; return sec()-t0;
}
int main(int c,char**v){ (void)c;
  void*L=dlopen(v[1],RTLD_NOW); if(!L){printf("dlopen fail\n");return 2;}
  R=(rst)dlsym(L,"gate_reset"); G=(reg)dlsym(L,"gate_register_service");
  A=(att)dlsym(L,"gate_report_attestation"); O=(rol)dlsym(L,"gate_set_environment_rollout");
  D=(adm)dlsym(L,"gate_check_admission");
  int ns[]={5000,10000,20000,40000}; double prev=0;
  for(int i=0;i<4;++i){ double t=run(ns[i],20);
    printf("N=%-6d %8.4fs  per-op %6.2fns  ratio %s\n", ns[i], t, t/ (ns[i]*20.0) *1e9,
      prev>0 ? "" : "-");
    if(prev>0) printf("            growth vs prev (2x N): %.2fx\n", t/prev);
    prev=t; }
  return 0; }

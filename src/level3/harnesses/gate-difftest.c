/* Differential fuzz: original (reference) vs patched (memoised).
   Any divergence in admission/audit/count = the memo is stale. */
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int exists,rollout_enabled,attested,waiver_active,blocked_direct,
                 blocked_transitive,stale_attestation,conflicting_evidence,admissible; } AV;
typedef struct {
  void(*reset)(void); int(*reg)(int); int(*dep)(int,int);
  int(*att)(int,int,int,int64_t,int64_t); int(*rol)(int,int,int);
  int(*wai)(int,int,int64_t); int(*blk)(int,int);
  int(*adm)(int,int,int64_t); int(*aud)(int,int,int64_t,AV*); int(*cnt)(int,int64_t);
} API;
static void load(API*a,const char*p){ void*L=dlopen(p,RTLD_NOW|RTLD_LOCAL);
  if(!L){printf("dlopen %s failed\n",p);exit(2);}
  a->reset=dlsym(L,"gate_reset"); a->reg=dlsym(L,"gate_register_service");
  a->dep=dlsym(L,"gate_set_dependency"); a->att=dlsym(L,"gate_report_attestation");
  a->rol=dlsym(L,"gate_set_environment_rollout"); a->wai=dlsym(L,"gate_add_waiver");
  a->blk=dlsym(L,"gate_block_service"); a->adm=dlsym(L,"gate_check_admission");
  a->aud=dlsym(L,"gate_audit_get"); a->cnt=dlsym(L,"gate_count_admissible"); }
static unsigned st=12345u;
static unsigned rnd(void){ st=st*1664525u+1013904223u; return st>>8; }
int main(void){
  API A,B; load(&A,"gate_c.dylib"); load(&B,"gate_c_patched.dylib");
  int diffs=0, checks=0;
  for(int trial=0; trial<400 && diffs<10; ++trial){
    A.reset(); B.reset();
    int N=3+(int)(rnd()%12), ENVS=3;
    for(int i=1;i<=N;++i){ A.reg(i); B.reg(i); }
    for(int step=0; step<160 && diffs<10; ++step){
      int s=1+(int)(rnd()%N), e=10+(int)(rnd()%ENVS);
      int64_t ts=(int64_t)(rnd()%1000);
      switch(rnd()%7){
        case 0:{int d=1+(int)(rnd()%N); if(d!=s){A.dep(s,d);B.dep(s,d);} break;}
        case 1:{int stt=(int)(rnd()%3); int64_t o=(int64_t)(rnd()%500),u=o+(int64_t)(rnd()%600);
                A.att(s,e,stt,o,u); B.att(s,e,stt,o,u); break;}
        case 2:{int en=(int)(rnd()%2); A.rol(s,e,en); B.rol(s,e,en); break;}
        case 3:{int64_t u=(int64_t)(rnd()%900); A.wai(s,e,u); B.wai(s,e,u); break;}
        case 4:{int b=(int)(rnd()%2); A.blk(s,b); B.blk(s,b); break;}
        default: break;
      }
      /* compare every observable at a random query point */
      int qa=A.adm(s,e,ts), qb=B.adm(s,e,ts); ++checks;
      if(qa!=qb){ printf("DIFF admit s=%d e=%d ts=%lld  ref=%d patched=%d\n",s,e,(long long)ts,qa,qb); ++diffs; }
      AV va,vb; memset(&va,0,sizeof va); memset(&vb,0,sizeof vb);
      int ra=A.aud(s,e,ts,&va), rb=B.aud(s,e,ts,&vb); ++checks;
      if(ra!=rb||memcmp(&va,&vb,sizeof va)!=0){ printf("DIFF audit s=%d e=%d ts=%lld\n",s,e,(long long)ts); ++diffs; }
      int ca=A.cnt(e,ts), cb=B.cnt(e,ts); ++checks;
      if(ca!=cb){ printf("DIFF count e=%d ts=%lld ref=%d patched=%d\n",e,(long long)ts,ca,cb); ++diffs; }
    }
  }
  printf("%s  %d comparisons, %d divergences\n", diffs?"FAIL":"PASS", checks, diffs);
  return diffs?1:0; }

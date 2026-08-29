/* 3-way differential fuzz: C vs C++ vs Rust implementations of the
   Session Credential Rotation registry. Divergence = at least one is wrong. */
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int exists,session_revoked,active_generation,staged_generation,
  presented_generation,grace_generation,grace_active,generation_revoked,
  compatible,usable; } AV;
typedef struct { const char*tag; void(*reset)(void); int(*create)(int,int,int,int);
  int(*issue)(int,int,int,int64_t,int64_t); int(*stage)(int,int,int64_t);
  int(*activate)(int,int64_t); int(*revoke)(int,int); int(*check)(int,int,int64_t);
  int(*audit)(int,int,int64_t,AV*); int(*count)(int,int64_t); int(*err)(void); } API;
static void load(API*a,const char*p,const char*tag){ void*L=dlopen(p,RTLD_NOW|RTLD_LOCAL);
  if(!L){printf("dlopen %s: %s\n",p,dlerror());exit(2);} a->tag=tag;
  a->reset=dlsym(L,"session_reset"); a->create=dlsym(L,"session_create");
  a->issue=dlsym(L,"session_issue_credential"); a->stage=dlsym(L,"session_stage_generation");
  a->activate=dlsym(L,"session_activate_generation"); a->revoke=dlsym(L,"session_revoke");
  a->check=dlsym(L,"session_check"); a->audit=dlsym(L,"session_audit_get");
  a->count=dlsym(L,"session_count_active"); a->err=dlsym(L,"session_last_error"); }
static unsigned st=777u;
static unsigned rnd(void){ st=st*1664525u+1013904223u; return st>>8; }
int main(void){
  API imp[3]; load(&imp[0],"cred_c.dylib","C"); load(&imp[1],"cred_cpp.dylib","C++");
  load(&imp[2],"cred_rs.dylib","Rust");
  int diffs=0,cmps=0;
  static char log[400][128]; int nlog=0;
  for(int trial=0; trial<300 && diffs<8; ++trial){
    for(int k=0;k<3;++k) imp[k].reset();
    nlog=0;
    int N=3+(int)(rnd()%6);
    for(int i=1;i<=N;++i){ int subj=100+(int)(rnd()%3);
      for(int k=0;k<3;++k){ imp[k].create(i,subj,7,1); imp[k].issue(1000+i,i,1,0,100000);}
      snprintf(log[nlog++],128,"create(s=%d,subj=%d,res=7,gen=1); issue(cred=%d,s=%d,gen=1,0,100000)",i,subj,1000+i,i); }
    for(int step=0; step<120 && diffs<8; ++step){
      int s=1+(int)(rnd()%N), g=(int)(rnd()%4), subj=100+(int)(rnd()%3);
      int64_t ts=(int64_t)(rnd()%800);
      switch(rnd()%5){
        case 0:{int64_t gr=(int64_t)(rnd()%900); for(int k=0;k<3;++k) imp[k].stage(s,g+2,gr); snprintf(log[nlog++],128,"stage(s=%d,gen=%d,grace=%lld)",s,g+2,(long long)gr); break;}
        case 1: for(int k=0;k<3;++k) imp[k].activate(s,ts); snprintf(log[nlog++],128,"activate(s=%d,ts=%lld)",s,(long long)ts); break;
        case 2:{int rg=(rnd()%4==0)?-1:g; for(int k=0;k<3;++k) imp[k].revoke(s,rg); snprintf(log[nlog++],128,"revoke(s=%d,gen=%d)",s,rg); break;}
        case 3:{int64_t e=ts+(int64_t)(rnd()%500); int cid=5000+(int)rnd()%9000; for(int k=0;k<3;++k) imp[k].issue(cid,s,g,ts,e); snprintf(log[nlog++],128,"issue(cred=%d,s=%d,gen=%d,iss=%lld,exp=%lld)",cid,s,g,(long long)ts,(long long)e); break;}
        default: break;
      }
      int r[3]; for(int k=0;k<3;++k) r[k]=imp[k].check(s,g,ts); ++cmps;
      if(r[0]!=r[1]||r[0]!=r[2]){ printf("\n=== DIFF check(s=%d,g=%d,ts=%lld) -> C=%d C++=%d Rust=%d\nREPRO:\n",s,g,(long long)ts,r[0],r[1],r[2]); for(int q=0;q<nlog;++q) printf("  %s\n",log[q]); printf("  check(s=%d,gen=%d,ts=%lld)\n",s,g,(long long)ts); ++diffs; return 1; }
      AV v[3]; int ra[3];
      for(int k=0;k<3;++k){ memset(&v[k],0,sizeof v[k]); ra[k]=imp[k].audit(s,g,ts,&v[k]); } ++cmps;
      if(ra[0]!=ra[1]||ra[0]!=ra[2]||memcmp(&v[0],&v[1],sizeof v[0])||memcmp(&v[0],&v[2],sizeof v[0])){
        printf("DIFF audit s=%d g=%d ts=%lld (rc %d/%d/%d)\n",s,g,(long long)ts,ra[0],ra[1],ra[2]); ++diffs; }
      int c[3]; for(int k=0;k<3;++k) c[k]=imp[k].count(subj,ts); ++cmps;
      if(c[0]!=c[1]||c[0]!=c[2]){ printf("DIFF count subj=%d ts=%lld -> %d/%d/%d\n",subj,(long long)ts,c[0],c[1],c[2]); ++diffs; }
    }
  }
  printf("%s  %d comparisons across 3 implementations, %d divergences\n", diffs?"FAIL":"PASS", cmps, diffs);
  return diffs?1:0; }

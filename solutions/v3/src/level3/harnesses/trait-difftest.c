/* 3-way differential fuzz for Trait Expression AST: C vs C++ vs Rust.
   IMPORTANT: every random input is generated ONCE and fed identically to all
   three implementations (the mistake that produced false positives earlier). */
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int exists,kind,string_evaluable,match_evaluable,constant_expr,
                 namespace_error,matched,output_string_id; } AV;
typedef struct { const char*tag; void(*reset)(void); int(*rstr)(int,const char*);
  int(*rvar)(int,int,int); int(*lit)(int,int); int(*cvar)(int,int); int(*email)(int,int);
  int(*repl)(int,int,int,int); int(*match)(int,int,int,int); int(*evstr)(int,int*);
  int(*evm)(int,int); int(*aud)(int,int,AV*); int(*err)(void); } API;
static void L(API*a,const char*p,const char*t){ void*h=dlopen(p,RTLD_NOW|RTLD_LOCAL);
  if(!h){printf("dlopen %s: %s\n",p,dlerror());exit(2);} a->tag=t;
  a->reset=dlsym(h,"expr_reset"); a->rstr=dlsym(h,"expr_register_string");
  a->rvar=dlsym(h,"expr_register_var"); a->lit=dlsym(h,"expr_compile_literal");
  a->cvar=dlsym(h,"expr_compile_var"); a->email=dlsym(h,"expr_compile_email_local");
  a->repl=dlsym(h,"expr_compile_regex_replace"); a->match=dlsym(h,"expr_compile_regex_match");
  a->evstr=dlsym(h,"expr_evaluate_string"); a->evm=dlsym(h,"expr_evaluate_match");
  a->aud=dlsym(h,"expr_audit_get"); a->err=dlsym(h,"expr_last_error"); }
static unsigned st=20260827u;
static unsigned rnd(void){ st=st*1664525u+1013904223u; return st>>8; }
static const char*WORDS[8]={"alice@example.com","bob@test.org","carol","a","example","sample","X","d@e@f"};
int main(int argc,char**argv){ (void)argc;(void)argv;
  API m[3]; L(&m[0],"trait_c.dylib","C"); L(&m[1],"trait_cpp.dylib","C++"); L(&m[2],"trait_rs.dylib","Rust");
  int diffs=0,cmps=0;
  static char lg[200][160]; int nl=0;
  for(int trial=0; trial<250 && diffs<6; ++trial){
    for(int k=0;k<3;++k) m[k].reset(); nl=0;
    for(int i=0;i<8;++i){ for(int k=0;k<3;++k) m[k].rstr(i+1,WORDS[i]); snprintf(lg[nl++],160,"rstr(%d,\"%s\")",i+1,WORDS[i]); }
    /* vars: some valid namespaces (1..3), some invalid */
    for(int v=1; v<=6; ++v){ int ns = (v%3==0)? (int)(90+rnd()%10) : (int)(1+rnd()%3);
      int sid = 1+(int)(rnd()%8);
      for(int k=0;k<3;++k) m[k].rvar(v,ns,sid); snprintf(lg[nl++],160,"rvar(%d,ns=%d,sid=%d)",v,ns,sid); }
    int next_expr=10, pool[64], np=0;
    for(int step=0; step<40 && diffs<6; ++step){
      int id=next_expr++;
      int choice=(int)(rnd()%5);
      int made=0;
      if(choice==0){ int s=1+(int)(rnd()%8); for(int k=0;k<3;++k) m[k].lit(id,s); snprintf(lg[nl++],160,"lit(%d,sid=%d)",id,s); made=1; }
      else if(choice==1){ int v=1+(int)(rnd()%6); for(int k=0;k<3;++k) m[k].cvar(id,v); snprintf(lg[nl++],160,"cvar(%d,var=%d)",id,v); made=1; }
      else if(np>0){
        int c=pool[rnd()%np];
        if(choice==2){ for(int k=0;k<3;++k) m[k].email(id,c); snprintf(lg[nl++],160,"email(%d,child=%d)",id,c); made=1; }
        else if(choice==3){ int p=1+(int)(rnd()%8), r=1+(int)(rnd()%8);
                            for(int k=0;k<3;++k) m[k].repl(id,c,p,r); snprintf(lg[nl++],160,"repl(%d,child=%d,pat=%d,rep=%d)",id,c,p,r); made=1; }
        else { int p=1+(int)(rnd()%8), n=(int)(rnd()%2);
               for(int k=0;k<3;++k) m[k].match(id,c,p,n); snprintf(lg[nl++],160,"match(%d,child=%d,pat=%d,neg=%d)",id,c,p,n); made=1; }
      }
      if(!made) continue;
      if(choice!=4 && np<64) pool[np++]=id;   /* only string-producing in pool */

      int o[3],r[3];
      for(int k=0;k<3;++k){ o[k]=-1; r[k]=m[k].evstr(id,&o[k]); } ++cmps;
      if(r[0]!=r[1]||r[0]!=r[2]){ printf("DIFF evstr id=%d rc C=%d C++=%d Rust=%d\n",id,r[0],r[1],r[2]); ++diffs; }
      int mm=1+(int)(rnd()%8), q[3];
      for(int k=0;k<3;++k) q[k]=m[k].evm(id,mm); ++cmps;
      if(q[0]!=q[1]||q[0]!=q[2]){ printf("DIFF evmatch id=%d s=%d -> %d/%d/%d\n",id,mm,q[0],q[1],q[2]); ++diffs; }
      AV v[3]; int ra[3];
      for(int k=0;k<3;++k){ memset(&v[k],0,sizeof v[k]); ra[k]=m[k].aud(id,mm,&v[k]); } ++cmps;
      if(ra[0]!=ra[1]||ra[0]!=ra[2]){ printf("DIFF audit rc id=%d -> %d/%d/%d\n",id,ra[0],ra[1],ra[2]); ++diffs; continue; }
      static const char*FN[8]={"exists","kind","string_evaluable","match_evaluable","constant_expr","namespace_error","matched","output_string_id"};
      int*pa=(int*)&v[0],*pb=(int*)&v[1],*pc=(int*)&v[2];
      for(int f=0;f<8;++f) if(pa[f]!=pb[f]||pa[f]!=pc[f]){
        printf("\n=== DIFF audit id=%d field %s C=%d C++=%d Rust=%d\nREPRO:\n",id,FN[f],pa[f],pb[f],pc[f]); for(int q=0;q<nl;++q) printf("  %s\n",lg[q]); printf("  evstr(%d); evmatch(%d,%d); audit(%d,%d)\n",id,id,mm,id,mm); return 1; }
    }
  }
  printf("%s  %d comparisons across 3 implementations, %d divergences\n", diffs?"FAIL":"PASS", cmps, diffs);
  return diffs?1:0; }
